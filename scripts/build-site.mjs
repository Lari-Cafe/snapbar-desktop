import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, "..");
const viteBin = join(projectRoot, "node_modules", "vite", "bin", "vite.js");

execFileSync(process.execPath, [viteBin, "build", "--config", "site/vite.config.ts"], {
  cwd: projectRoot,
  stdio: "inherit",
});

const dist = join(projectRoot, "dist-site");
mkdirSync(dist, { recursive: true });

for (const file of ["_headers", "_redirects"]) {
  const from = join(projectRoot, "site", file);
  if (existsSync(from)) cpSync(from, join(dist, file));
}

console.log("Snapbar site built to dist-site");
