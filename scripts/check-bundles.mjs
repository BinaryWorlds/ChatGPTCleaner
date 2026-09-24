import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function readJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) contents.push(await readJavaScript(path));
    if (entry.isFile() && entry.name.endsWith(".js")) {
      contents.push(await readFile(path, "utf8"));
    }
  }
  return contents.flat().join("\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const productionBundle = await readJavaScript(".output/chrome-mv3");
const demoBundle = await readJavaScript(".output/chrome-mv3-demo");

for (const fakeMarker of ["standalone-001", "project-alpha-page-2"]) {
  assert(
    !productionBundle.includes(fakeMarker),
    `Production bundle contains fake fixture marker: ${fakeMarker}`,
  );
}

for (const productionMarker of [
  "chatgpt-cleaner:destructive-run:v1",
  "TRUSTED_CONTEXTS",
]) {
  assert(
    !demoBundle.includes(productionMarker),
    `Demo bundle contains production infrastructure marker: ${productionMarker}`,
  );
}

for (const readPath of [
  "/backend-api/conversations",
  "/backend-api/gizmos/snorlax/sidebar",
]) {
  assert(
    productionBundle.includes(readPath),
    `Production bundle is missing read integration: ${readPath}`,
  );
  assert(
    !demoBundle.includes(readPath),
    `Demo bundle contains a real ChatGPT read path: ${readPath}`,
  );
}

for (const destructiveMarker of [
  "/backend-api/conversation/id/",
  "delete-conversation",
]) {
  assert(
    productionBundle.includes(destructiveMarker),
    `Production bundle is missing the narrow DELETE transport: ${destructiveMarker}`,
  );
  assert(
    !demoBundle.includes(destructiveMarker),
    `Demo bundle contains production destructive transport: ${destructiveMarker}`,
  );
}

console.log("Production/demo bundle composition checks passed.");
