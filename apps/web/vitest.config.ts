import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const sourceDirectory = fileURLToPath(new URL("./src", import.meta.url))
const serverOnlyStub = fileURLToPath(
  new URL("./src/test/server-only.ts", import.meta.url),
)

export default defineConfig({
  define: {
    "process.env.NEXT_PUBLIC_ENABLE_PIN_LOGIN": JSON.stringify("true"),
  },
  resolve: {
    alias: {
      "@": sourceDirectory,
      "server-only": serverOnlyStub,
    },
  },
  test: {
    clearMocks: true,
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    include: ["src/**/*.test.{ts,tsx}"],
    mockReset: true,
    restoreMocks: true,
    setupFiles: ["./src/test/setup.ts"],
  },
})
