import { readFile } from "node:fs/promises";

const manifestPath = ".output/chrome-mv3/manifest.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const expectedPermissions = ["activeTab", "scripting", "storage"];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(manifest.manifest_version === 3, "Expected Manifest V3.");
assert(
  manifest.minimum_chrome_version === "120",
  "Expected minimum Chrome version 120.",
);
assert(
  manifest.action?.default_title === "Open ChatGPTCleaner",
  "Expected a launchable extension action.",
);
assert(
  JSON.stringify([...manifest.permissions].sort()) ===
    JSON.stringify([...expectedPermissions].sort()),
  "Manifest permissions differ from the approved baseline.",
);
assert(
  manifest.host_permissions === undefined,
  "Unexpected host permissions are present.",
);
assert(
  manifest.externally_connectable === undefined,
  "Unexpected externally_connectable configuration is present.",
);
assert(
  manifest.web_accessible_resources === undefined,
  "Unexpected web-accessible resources are present.",
);

console.log(`Manifest security checks passed: ${manifestPath}`);
