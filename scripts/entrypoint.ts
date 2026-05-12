import { spawn } from "node:child_process";

const role = (process.env.PROCESS ?? "webapp").toLowerCase();

function run(cmd: string, args: string[]) {
  const child = spawn(cmd, args, { stdio: "inherit", env: process.env });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}

switch (role) {
  case "webapp":
    run("node", ["server.js"]);
    break;
  case "bridge":
    run("bun", ["bridge/index.ts"]);
    break;
  case "db-push":
    run("bunx", ["drizzle-kit", "push"]);
    break;
  default:
    console.error(`unknown PROCESS=${role}; expected webapp | bridge | db-push`);
    process.exit(1);
}
