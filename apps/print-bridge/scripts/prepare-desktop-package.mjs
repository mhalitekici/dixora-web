import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bridgeDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(bridgeDirectory, "..", "..");
const stageDirectory = join(bridgeDirectory, "desktop-package");

async function copy(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

await rm(stageDirectory, { recursive: true, force: true });
await mkdir(stageDirectory, { recursive: true });
await copy(join(bridgeDirectory, "dist"), join(stageDirectory, "dist"));
await copy(
  join(bridgeDirectory, "desktop-dist"),
  join(stageDirectory, "desktop-dist"),
);
await copy(
  join(bridgeDirectory, "desktop", "assets", "icon.png"),
  join(stageDirectory, "assets", "icon.png"),
);
await copy(
  join(bridgeDirectory, "desktop", "assets", "icon.icns"),
  join(stageDirectory, "assets", "icon.icns"),
);
await copy(
  join(repositoryDirectory, "packages", "config", "dist"),
  join(stageDirectory, "node_modules", "@dixora", "config", "dist"),
);
await copy(
  join(repositoryDirectory, "packages", "config", "package.json"),
  join(stageDirectory, "node_modules", "@dixora", "config", "package.json"),
);
await copy(
  join(repositoryDirectory, "packages", "shared-types", "dist"),
  join(stageDirectory, "node_modules", "@dixora", "shared-types", "dist"),
);
await copy(
  join(repositoryDirectory, "packages", "shared-types", "package.json"),
  join(
    stageDirectory,
    "node_modules",
    "@dixora",
    "shared-types",
    "package.json",
  ),
);
await copy(
  join(bridgeDirectory, "electron-builder.yml"),
  join(stageDirectory, "electron-builder.yml"),
);

await writeFile(
  join(stageDirectory, "package.json"),
  `${JSON.stringify(
    {
      name: "dixora-print-bridge-desktop",
      version: "0.1.0",
      description: "Dixora local physical printing agent",
      author: "Dixora",
      private: true,
      main: "desktop-dist/main.mjs",
      type: "module",
      dependencies: {
        "@dixora/config": "0.1.0",
        "@dixora/shared-types": "0.1.0",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
