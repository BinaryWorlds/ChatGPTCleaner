import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: ({ mode }) => ({
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
