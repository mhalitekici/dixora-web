import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bridgeDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(bridgeDirectory, "..", "..");
const installer = join(
  repositoryDirectory,
  "release",
  "dixora-print-bridge-desktop",
  "Dixora-Print-Bridge.dmg",
);
const publishedInstaller = join(
  repositoryDirectory,
  "apps",
  "web",
  "public",
  "downloads",
  "Dixora-Print-Bridge.dmg",
);

await access(installer);
await mkdir(dirname(publishedInstaller), { recursive: true });
await copyFile(installer, publishedInstaller);
process.stdout.write(`macOS installer published at ${publishedInstaller}\n`);
