import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bridgeDirectory = resolve(scriptDirectory, "..");
const sourceDirectory = join(bridgeDirectory, "desktop");
const outputDirectory = join(bridgeDirectory, "desktop-dist");

await mkdir(outputDirectory, { recursive: true });
for (const file of ["index.html", "renderer.css", "renderer.js"]) {
  await cp(join(sourceDirectory, file), join(outputDirectory, file));
}

// `main.mjs` already declares ESM explicitly and `preload.cjs` declares CJS.
// This marker makes any future compiled .js helper follow the desktop runtime.
await writeFile(join(outputDirectory, "package.json"), '{"type":"module"}\n');
