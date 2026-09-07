import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bridgePlatformLabel,
  discoverSystemPrinters,
  startBridgeRuntime,
  type BridgeRuntime,
} from "../dist/agent-runtime.js";
import { loadCredential } from "../dist/credentials.js";
import { runEnroll } from "../dist/enroll.js";
import { safeErrorMessage } from "../dist/protocol.js";

interface DesktopSettings {
  apiUrl: string;
  computerName: string;
}

interface EnrollmentInput {
  apiUrl: string;
  code: string;
  computerName: string;
}

interface DesktopStatus {
  apiUrl: string | null;
  computerName: string;
  enrolled: boolean;
  lastError: string | null;
  platform: "windows" | "macos" | "linux";
  printers: readonly string[];
  runtime: ReturnType<BridgeRuntime["state"]["snapshot"]> | null;
}

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const startedInBackground = process.argv.includes("--background");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let runtime: BridgeRuntime | null = null;
let agentStart: Promise<void> | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let settings: DesktopSettings | null = null;
let lastError: string | null = null;
let lastPrinters: readonly string[] = [];
let isQuitting = false;

function dataPaths() {
  const root = app.getPath("userData");
  return {
    credentials: join(root, "credentials.json"),
    journal: join(root, "journal.json"),
    settings: join(root, "settings.json"),
  };
}

function configureAgentEnvironment(nextSettings: DesktopSettings): void {
  const paths = dataPaths();
  process.env.NODE_ENV = "production";
  process.env.PRINT_BRIDGE_API_URL = nextSettings.apiUrl;
  process.env.PRINT_BRIDGE_TRANSPORT = "auto";
  process.env.PRINT_BRIDGE_PORT = "0";
  process.env.PRINT_BRIDGE_VERSION = app.getVersion();
  process.env.PRINT_BRIDGE_CREDENTIALS_PATH = paths.credentials;
  process.env.PRINT_BRIDGE_JOURNAL_PATH = paths.journal;

  // A desktop installation must use its own enrolled credential, never a
  // developer token inherited from the shell that opened the app.
  delete process.env.PRINT_BRIDGE_API_KEY;
  delete process.env.PRINT_BRIDGE_BRANCH_ID;
  delete process.env.PRINT_BRIDGE_PRINTER_IDS;
  delete process.env.PRINT_BRIDGE_TOKEN;
}

async function loadSettings(): Promise<DesktopSettings | null> {
  try {
    const raw = await readFile(dataPaths().settings, "utf8");
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value.apiUrl !== "string" ||
      typeof value.computerName !== "string"
    ) {
      return null;
    }
    return {
      apiUrl: validateApiUrl(value.apiUrl),
      computerName: normalizeComputerName(value.computerName),
    };
  } catch {
    return null;
  }
}

async function saveSettings(nextSettings: DesktopSettings): Promise<void> {
  const path = dataPaths().settings;
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.next`;
  await writeFile(temporaryPath, JSON.stringify(nextSettings, null, 2), "utf8");
  await rename(temporaryPath, path);
}

async function startBridgeIfEnrolled(): Promise<void> {
  if (!settings || runtime || agentStart) return agentStart ?? undefined;

  agentStart = (async () => {
    configureAgentEnvironment(settings!);
    const credential = await loadCredential(dataPaths().credentials);
    if (!credential) return;

    try {
      const candidate = await startBridgeRuntime();
      runtime = candidate;
      lastError = null;
      void candidate.completed
        .then(() => handleBridgeStopped(candidate, null))
        .catch((error: unknown) =>
          handleBridgeStopped(candidate, safeErrorMessage(error)),
        );
    } catch (error) {
      lastError = safeErrorMessage(error);
      scheduleRestart();
    }
  })().finally(() => {
    agentStart = null;
  });

  return agentStart;
}

function handleBridgeStopped(
  candidate: BridgeRuntime,
  error: string | null,
): void {
  if (runtime !== candidate) return;
  runtime = null;
  if (error) lastError = error;
  if (!isQuitting) scheduleRestart();
}

function scheduleRestart(): void {
  if (isQuitting || restartTimer || !settings) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void startBridgeIfEnrolled();
  }, 10_000);
}

async function stopBridge(): Promise<void> {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  const activeRuntime = runtime;
  if (!activeRuntime) return;
  activeRuntime.stop();
  await Promise.race([
    activeRuntime.completed.catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (runtime === activeRuntime) runtime = null;
}

async function refreshPrinters(): Promise<readonly string[]> {
  try {
    lastPrinters = await discoverSystemPrinters();
    lastError = null;
  } catch (error) {
    lastError = safeErrorMessage(error);
  }
  return lastPrinters;
}

async function desktopStatus(): Promise<DesktopStatus> {
  const enrolled = Boolean(await loadCredential(dataPaths().credentials));
  return {
    apiUrl: settings?.apiUrl ?? null,
    computerName: settings?.computerName ?? hostname(),
    enrolled,
    lastError,
    platform: bridgePlatformLabel(),
    printers: lastPrinters,
    runtime: runtime?.state.snapshot() ?? null,
  };
}

async function enroll(input: EnrollmentInput): Promise<DesktopStatus> {
  const nextSettings: DesktopSettings = {
    apiUrl: validateApiUrl(input.apiUrl),
    computerName: normalizeComputerName(input.computerName),
  };
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    throw new Error("Bağlantı kodu XXXX-XXXX biçiminde olmalıdır.");
  }

  await stopBridge();
  configureAgentEnvironment(nextSettings);
  await runEnroll({
    apiUrl: nextSettings.apiUrl,
    code,
    name: nextSettings.computerName,
    platform: bridgePlatformLabel(),
    version: app.getVersion(),
    credentialsPath: dataPaths().credentials,
  });
  settings = nextSettings;
  await saveSettings(nextSettings);
  enableLoginStartup();
  await refreshPrinters();
  await startBridgeIfEnrolled();
  return desktopStatus();
}

function validateApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Geçerli bir Dixora API adresi girin.");
  }
  const localHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(
      url.hostname,
    );
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Canlı kullanımda API adresi HTTPS olmalıdır.");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeComputerName(value: string): string {
  const name = value.trim();
  if (name.length < 2 || name.length > 120) {
    throw new Error("Bilgisayar adı 2 ila 120 karakter arasında olmalıdır.");
  }
  return name;
}

function enableLoginStartup(): void {
  if (process.platform === "win32" || process.platform === "darwin") {
    app.setLoginItemSettings({ openAtLogin: true, args: ["--background"] });
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 520,
    height: 680,
    minWidth: 440,
    minHeight: 600,
    show: false,
    backgroundColor: "#f6f7f8",
    title: "Dixora Print Bridge",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(desktopDirectory, "preload.cjs"),
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  void window.loadFile(join(desktopDirectory, "index.html"));
  return window;
}

function createTray(): Tray {
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#d84727"/><path fill="#fff" d="M8 9h16v8H8zM10 11v4h12v-4zm-3 8h18v5H7zM11 21v2h10v-2z"/></svg>',
    ).toString("base64")}`,
  );
  const nextTray = new Tray(icon);
  nextTray.setToolTip("Dixora Print Bridge");
  nextTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Dixora Print Bridge", enabled: false },
      { type: "separator" },
      { label: "Pencereyi aç", click: showWindow },
      {
        label: "Çıkış",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  nextTray.on("click", showWindow);
  return nextTray;
}

function showWindow(): void {
  if (!mainWindow) mainWindow = createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function inputFrom(value: unknown): EnrollmentInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("Kurulum bilgileri geçersiz.");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.apiUrl !== "string" ||
    typeof record.code !== "string" ||
    typeof record.computerName !== "string"
  ) {
    throw new Error("Kurulum bilgileri eksik.");
  }
  return {
    apiUrl: record.apiUrl,
    code: record.code,
    computerName: record.computerName,
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle("bridge:status", () => desktopStatus());
  ipcMain.handle("bridge:refresh-printers", async () => {
    await refreshPrinters();
    return desktopStatus();
  });
  ipcMain.handle("bridge:enroll", async (_event, value: unknown) => {
    try {
      return { ok: true, status: await enroll(inputFrom(value)) };
    } catch (error) {
      return { ok: false, error: safeErrorMessage(error) };
    }
  });
  ipcMain.handle("bridge:hide-window", () => mainWindow?.hide());
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.dixora.print-bridge");
  }
  settings = await loadSettings();
  if (settings) configureAgentEnvironment(settings);
  registerIpcHandlers();
  tray = createTray();
  mainWindow = createWindow();
  await refreshPrinters();
  await startBridgeIfEnrolled();
  if (!startedInBackground) showWindow();
});

app.on("activate", showWindow);
app.on("before-quit", () => {
  isQuitting = true;
  runtime?.stop();
  tray?.destroy();
  tray = null;
});
