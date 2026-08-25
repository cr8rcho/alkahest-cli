// Build the Claude Desktop bundle (alkahest.mcpb) from mcpb/. A .mcpb is a plain zip with
// manifest.json at the root; the only build-time work is stamping the package version into
// the staged manifest (the checked-in one carries 0.0.0 so there is exactly one version to
// bump per release). Run: node scripts/build-mcpb.mjs → dist-mcpb/alkahest.mcpb
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, "dist-mcpb", "stage");
const out = join(root, "dist-mcpb", "alkahest.mcpb");

rmSync(join(root, "dist-mcpb"), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, "mcpb"), stage, { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// zip contents at the archive root (manifest.json must not sit inside a folder).
execFileSync("zip", ["-r", "-X", out, "."], { cwd: stage, stdio: "inherit" });
console.log(`built ${out} (v${pkg.version})`);
