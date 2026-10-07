import { readFile } from "node:fs/promises";

const manifestPath = ".output/chrome-mv3/manifest.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const expectedPermissions = ["activeTab", "scripting", "storage"];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseContentSecurityPolicy(policy) {
  const directives = new Map();

  for (const directiveText of policy.split(";")) {
    const tokens = directiveText.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const [name, ...sources] = tokens;
    const normalizedName = name.toLowerCase();
    assert(
      !directives.has(normalizedName),
      `Duplicate extension-page CSP directive: ${normalizedName}.`,
    );
    directives.set(normalizedName, sources);
  }

  return directives;
}

function resolveSources(directives, directiveNames) {
  for (const directiveName of directiveNames) {
    const sources = directives.get(directiveName);
    if (sources !== undefined) return sources;
  }
  return undefined;
}

function isLocalScriptSource(source) {
  const normalizedSource = source.toLowerCase();
  return (
    normalizedSource === "'self'" ||
    normalizedSource === "'none'" ||
    normalizedSource === "'report-sample'" ||
    normalizedSource === "'unsafe-inline'" ||
    normalizedSource === "'unsafe-hashes'" ||
    /^'nonce-[^']+'$/.test(normalizedSource) ||
    /^'sha(?:256|384|512)-[^']+'$/.test(normalizedSource)
  );
}

export function assertSafeExtensionPagesCsp(contentSecurityPolicy) {
  if (contentSecurityPolicy === undefined) return;

  assert(
    contentSecurityPolicy !== null &&
      typeof contentSecurityPolicy === "object" &&
      !Array.isArray(contentSecurityPolicy),
    "Manifest V3 content_security_policy must be an object.",
  );

  const extensionPagesPolicy = contentSecurityPolicy.extension_pages;
  if (extensionPagesPolicy === undefined) return;
  assert(
    typeof extensionPagesPolicy === "string" &&
      extensionPagesPolicy.trim().length > 0,
    "Extension-page CSP must be a non-empty string.",
  );

  const directives = parseContentSecurityPolicy(extensionPagesPolicy);
  const executableDirectiveFallbacks = [
    ["script-src", "default-src"],
    ["script-src-elem", "script-src", "default-src"],
    ["script-src-attr", "script-src", "default-src"],
    ["worker-src", "child-src", "script-src", "default-src"],
  ];

  for (const directiveNames of executableDirectiveFallbacks) {
    const sources = resolveSources(directives, directiveNames);
    assert(
      sources !== undefined,
      `Extension-page CSP does not constrain ${directiveNames[0]}.`,
    );
    assert(
      !sources.some((source) =>
        ["'unsafe-eval'", "'wasm-unsafe-eval'"].includes(source.toLowerCase()),
      ),
      `Extension-page CSP permits unsafe evaluation through ${directiveNames[0]}.`,
    );
    assert(
      sources.every(isLocalScriptSource),
      `Extension-page CSP permits a remote or dynamic script source through ${directiveNames[0]}.`,
    );
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
assertSafeExtensionPagesCsp(manifest.content_security_policy);

console.log(`Manifest security checks passed: ${manifestPath}`);
