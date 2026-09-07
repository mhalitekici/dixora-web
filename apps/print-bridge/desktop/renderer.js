const bridge = window.dixoraBridge;

const elements = {
  apiUrl: document.querySelector("#api-url"),
  apiUrlInput: document.querySelector("#api-url-input"),
  badge: document.querySelector("#connection-badge"),
  changeConnection: document.querySelector("#change-connection"),
  cloudStatus: document.querySelector("#cloud-status"),
  computerName: document.querySelector("#computer-name"),
  computerNameInput: document.querySelector("#computer-name-input"),
  connectionCode: document.querySelector("#connection-code"),
  connectedPanel: document.querySelector("#connected-panel"),
  enrollButton: document.querySelector("#enroll-button"),
  form: document.querySelector("#enrollment-form"),
  footerMessage: document.querySelector("#footer-message"),
  hideWindow: document.querySelector("#hide-window"),
  lastPrint: document.querySelector("#last-print"),
  printerList: document.querySelector("#printer-list"),
  refreshPrinters: document.querySelector("#refresh-printers"),
  runtimeError: document.querySelector("#runtime-error"),
  setupError: document.querySelector("#setup-error"),
  setupPanel: document.querySelector("#setup-panel"),
};

function runtimeLabel(status) {
  if (!status.enrolled) return "Bağlanmadı";
  if (status.runtime?.status === "ok") return "Çevrimiçi";
  if (status.runtime?.status === "degraded") return "Dikkat gerekli";
  return "Bağlanıyor";
}

function setBadge(status) {
  const label = runtimeLabel(status);
  elements.badge.textContent = label;
  elements.badge.className = "status-badge";
  elements.badge.classList.add(
    label === "Çevrimiçi"
      ? "status-ok"
      : status.enrolled
        ? "status-attention"
        : "status-muted",
  );
}

function formatDate(value) {
  if (!value) return "Henüz baskı yok";
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function renderPrinters(printers) {
  elements.printerList.replaceChildren();
  if (!printers.length) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "Yazıcı bulunamadı";
    elements.printerList.append(item);
    return;
  }
  for (const printer of printers) {
    const item = document.createElement("li");
    item.textContent = printer;
    elements.printerList.append(item);
  }
}

function render(status) {
  const connected = status.enrolled;
  setBadge(status);
  elements.connectedPanel.classList.toggle("hidden", !connected);
  elements.setupPanel.classList.toggle("hidden", connected);
  elements.computerName.textContent = status.computerName;
  elements.computerNameInput.value = status.computerName;
  elements.apiUrl.textContent = status.apiUrl ?? "-";
  elements.apiUrlInput.value = status.apiUrl ?? "http://localhost:8000";
  elements.cloudStatus.textContent = runtimeLabel(status);
  elements.lastPrint.textContent = formatDate(status.runtime?.lastPrintedAt);
  elements.footerMessage.textContent = connected
    ? "Bridge açık kaldığı sürece sipariş fişleri bu bilgisayardaki yazıcılara gönderilir."
    : "Bağlantı kodunu Dixora Yazıcı Yönetimi ekranından alın.";
  renderPrinters(status.printers);

  const error = status.lastError || status.runtime?.lastError;
  elements.runtimeError.textContent = error ?? "";
  elements.runtimeError.classList.toggle("hidden", !error || !connected);
}

function showSetup() {
  elements.connectedPanel.classList.add("hidden");
  elements.setupPanel.classList.remove("hidden");
  elements.connectionCode.focus();
}

async function refresh() {
  render(await bridge.status());
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.setupError.classList.add("hidden");
  elements.enrollButton.disabled = true;
  elements.enrollButton.textContent = "Bağlanıyor...";
  const result = await bridge.enroll({
    apiUrl: elements.apiUrlInput.value,
    code: elements.connectionCode.value,
    computerName: elements.computerNameInput.value,
  });
  elements.enrollButton.disabled = false;
  elements.enrollButton.textContent = "Bridge'i bağla";
  if (!result.ok) {
    elements.setupError.textContent = result.error || "Bağlantı kurulamadı.";
    elements.setupError.classList.remove("hidden");
    return;
  }
  elements.connectionCode.value = "";
  render(result.status);
});

elements.refreshPrinters.addEventListener("click", async () => {
  elements.refreshPrinters.disabled = true;
  render(await bridge.refreshPrinters());
  elements.refreshPrinters.disabled = false;
});
elements.changeConnection.addEventListener("click", showSetup);
elements.hideWindow.addEventListener("click", () => bridge.hideWindow());

void refresh();
setInterval(() => void refresh(), 3_000);
