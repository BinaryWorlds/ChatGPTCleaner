import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  alias: {
    "@manager-composition": "src/composition/production.ts",
    application: "src/application",
    composition: "src/composition",
    config: "src/config.ts",
    domain: "src/domain",
    i18n: "src/i18n",
    infrastructure: "src/infrastructure",
    ui: "src/ui",
  },
  vite: ({ mode }) => ({
    build: {
      sourcemap: mode === "debug" || mode === "demo",
    },
    plugins: [
      {
        name: "chatgpt-cleaner:manager-composition-alias",
        enforce: "post",
        config: () => ({
          resolve: {
            alias: {
              "@manager-composition": fileURLToPath(
                new URL(
                  mode === "demo"
                    ? "./src/composition/demo.ts"
                    : "./src/composition/production.ts",
                  import.meta.url,
                ),
              ),
            },
          },
        }),
      },
    ],
  }),
  manifest: {
    name: "ChatGPTCleaner",
    description:
      "Safely review and delete selected standalone ChatGPT conversations.",
    minimum_chrome_version: "120",
    permissions: ["activeTab", "scripting", "storage"],
    action: {
      default_title: "Open ChatGPTCleaner",
    },
  },
});
