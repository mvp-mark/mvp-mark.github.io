// Sets CACHE_NAME in sw.js to a hash of the files it caches, so any change
// to them gets a new cache (sw.js drops the old ones on activate).
// `npm run sw-version` updates sw.js; with --check it only reports, exiting
// with 1 when sw.js is out of date (used by CI).
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const swPath = join(root, "sw.js");
const sw = readFileSync(swPath, "utf8");

const list = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
if (!list) throw new Error("ASSETS não encontrado em sw.js");
// A folder ("./", "./en/") is its index.html.
const assets = [...new Set([...list[1].matchAll(/"([^"]+)"/g)]
  .map((m) => m[1])
  .map((asset) => (asset.endsWith("/") ? asset + "index.html" : asset)))];

const hash = createHash("sha256");
for (const asset of assets) {
  hash.update(asset + "\0");
  hash.update(readFileSync(join(root, asset)));
  hash.update("\0");
}
const name = `json-formatter-${hash.digest("hex").slice(0, 10)}`;
const updated = sw.replace(/const CACHE_NAME = "[^"]*";/, `const CACHE_NAME = "${name}";`);

if (process.argv.includes("--check")) {
  if (updated !== sw) {
    console.error(`sw.js desatualizado: rode "npm run sw-version" (CACHE_NAME deveria ser "${name}").`);
    process.exitCode = 1;
  } else {
    console.log(`sw.js em dia (${name}).`);
  }
} else if (updated !== sw) {
  writeFileSync(swPath, updated);
  console.log(`CACHE_NAME atualizado para "${name}".`);
} else {
  console.log(`sw.js já estava em dia (${name}).`);
}
