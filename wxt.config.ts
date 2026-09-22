import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
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
