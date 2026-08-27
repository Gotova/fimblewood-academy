import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MODULE_JSON = path.join(ROOT, "module.json");
const PACKAGE_JSON = path.join(ROOT, "package.json");
const README = path.join(ROOT, "README.md");

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node tools/bump-version.mjs <patch|minor|major|X.Y.Z>");
  process.exit(1);
}

function bump(current, part) {
  const [major, minor, patch] = current.split(".").map(Number);
  if (part === "major") return `${major + 1}.0.0`;
  if (part === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const module_ = JSON.parse(readFileSync(MODULE_JSON, "utf8"));
const current = module_.version;

const isExplicit = /^\d+\.\d+\.\d+$/.test(arg);
const next = isExplicit ? arg : bump(current, arg);

module_.version = next;
module_.download = module_.download.replace(
  /releases\/download\/v[\d.]+\/module\.zip/,
  `releases/download/v${next}/module.zip`
);

writeFileSync(MODULE_JSON, `${JSON.stringify(module_, null, 2)}\n`);

if (existsSync(PACKAGE_JSON)) {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  pkg.version = next;
  writeFileSync(PACKAGE_JSON, `${JSON.stringify(pkg, null, 2)}\n`);
}

// The README's version line drifted for several releases when it was a manual
// step, so the bump owns it now.
if (existsSync(README)) {
  const readme = readFileSync(README, "utf8");
  const updated = readme.replace(
    /^- \*\*Current version:\*\* .+$/m,
    `- **Current version:** ${next}`
  );
  if (updated !== readme) writeFileSync(README, updated);
  else console.warn("Warning: README.md has no '- **Current version:**' line to update.");
}

console.log(`Version bumped: ${current} -> ${next}`);
console.log(`Next steps: update CHANGELOG.md, commit, then run:`);
console.log(`  git tag v${next} && git push origin main --tags`);
