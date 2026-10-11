import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@manager-composition": fileURLToPath(
        new URL("./src/composition/production.ts", import.meta.url),
      ),
      application: fileURLToPath(new URL("./src/application", import.meta.url)),
      composition: fileURLToPath(new URL("./src/composition", import.meta.url)),
      config: fileURLToPath(new URL("./src/config.ts", import.meta.url)),
      domain: fileURLToPath(new URL("./src/domain", import.meta.url)),
      i18n: fileURLToPath(new URL("./src/i18n", import.meta.url)),
      infrastructure: fileURLToPath(
        new URL("./src/infrastructure", import.meta.url),
      ),
      ui: fileURLToPath(new URL("./src/ui", import.meta.url)),
    },
  },
  test: {
    restoreMocks: true,
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/infrastructure/fake/**",
        "src/composition/demo.ts",
      ],
      skipFull: true,
    },
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup.ts", "./src/test/uiSetup.ts"],
        },
      },
    ],
  },
});
