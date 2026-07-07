import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "packs", "_source");
const PACKS_DIR = path.join(ROOT, "packs");

const mode = process.argv[2];

if (!["compile", "extract"].includes(mode)) {
  console.error("Usage: node tools/build-packs.mjs <compile|extract>");
  process.exit(1);
}

if (!existsSync(SOURCE_DIR)) {
  console.error(`Source directory not found: ${SOURCE_DIR}`);
  process.exit(1);
}

const packNames = readdirSync(SOURCE_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

if (packNames.length === 0) {
  console.log("No pack sources found under packs/_source — nothing to do.");
  process.exit(0);
}

for (const name of packNames) {
  const sourcePath = path.join(SOURCE_DIR, name);
  const packPath = path.join(PACKS_DIR, name);

  if (mode === "compile") {
    mkdirSync(packPath, { recursive: true });
    console.log(`Compiling ${name} -> packs/${name}`);
    await compilePack(sourcePath, packPath, { recursive: true, log: true });
  } else {
    if (!existsSync(packPath)) {
      console.log(`Skipping ${name} — no compiled pack found at packs/${name}`);
      continue;
    }
    mkdirSync(sourcePath, { recursive: true });
    console.log(`Extracting packs/${name} -> ${sourcePath}`);
    await extractPack(packPath, sourcePath, { log: true });
  }
}

console.log("Done.");
