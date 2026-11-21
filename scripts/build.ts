#!/usr/bin/env bun
import { spawnSync } from "bun";

function runStep(label: string, cmd: string[]): void {
  console.log(`\n▶ ${label}...`);
  const res = spawnSync({
    cmd,
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
  });
  if (res.exitCode !== 0) {
    console.error(`✗ Failed at: ${label}`);
    process.exit(res.exitCode || 1);
  }
}

runStep("TypeScript check", [process.execPath, "x", "tsc", "--noEmit"]);
runStep("Build Web Studio (Vite)", [process.execPath, "x", "vite", "build"]);
runStep("Bundle Backend Engine (Bun)", [
  process.execPath,
  "build",
  "backend/main.ts",
  "--outfile=dist/server.js",
  "--target=bun",
]);

console.log("\n✓ Build completed cleanly: dist/client & dist/server.js");
