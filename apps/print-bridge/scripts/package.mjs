import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bridgeDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(bridgeDirectory, "..", "..");
const releaseDirectory = resolve(repositoryDirectory, "release");
const outputDirectory = resolve(releaseDirectory, "dixora-print-bridge");

function assertReleasePath() {
  const releasePrefix = `${releaseDirectory}${sep}`;
  if (!outputDirectory.startsWith(releasePrefix)) {
    throw new Error(
      `Refusing to package outside the release directory: ${outputDirectory}`,
    );
  }
}

async function copyRequired(source, destination) {
  await access(source);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

async function copyRuntimeDist(source, destination) {
  await access(source);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    force: true,
    // TypeScript does not delete old outputs when a source test is later
    // excluded from the production build. Never ship those stale test files.
    filter: (entry) => !entry.includes(".test."),
  });
}

async function packageBridge() {
  assertReleasePath();
  await mkdir(releaseDirectory, { recursive: true });
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  await copyRuntimeDist(
    join(bridgeDirectory, "dist"),
    join(outputDirectory, "dist"),
  );
  await copyRequired(
    join(bridgeDirectory, "scripts"),
    join(outputDirectory, "scripts"),
  );
  await copyRequired(
    join(bridgeDirectory, "README.md"),
    join(outputDirectory, "README.md"),
  );
  await copyRequired(
    join(repositoryDirectory, "packages", "config", "dist"),
    join(outputDirectory, "node_modules", "@dixora", "config", "dist"),
  );
  await copyRequired(
    join(repositoryDirectory, "packages", "config", "package.json"),
    join(outputDirectory, "node_modules", "@dixora", "config", "package.json"),
  );
  await copyRequired(
    join(repositoryDirectory, "packages", "shared-types", "dist"),
    join(outputDirectory, "node_modules", "@dixora", "shared-types", "dist"),
  );
  await copyRequired(
    join(repositoryDirectory, "packages", "shared-types", "package.json"),
    join(
      outputDirectory,
      "node_modules",
      "@dixora",
      "shared-types",
      "package.json",
    ),
  );

  await writeFile(
    join(outputDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "dixora-print-bridge-portable",
        private: true,
        type: "module",
        engines: { node: ">=22" },
        bin: { "dixora-print-bridge": "dist/index.js" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  process.stdout.write(
    `Portable Print Bridge package created at ${relative(repositoryDirectory, outputDirectory)}\n`,
  );
}

packageBridge().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
