#!/usr/bin/env bun
import { spawn } from "bun";

const backend = spawn({
  cmd: [process.execPath, "run", "--watch", "backend/main.ts"],
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
});

const frontend = spawn({
  cmd: [process.execPath, "x", "vite"],
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
});

const shutdown = () => {
  backend.kill();
  frontend.kill();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.all([backend.exited, frontend.exited]);
