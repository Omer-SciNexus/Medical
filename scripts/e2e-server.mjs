import { spawn } from "node:child_process";

// Keep this public/anonymous suite isolated from developer services and generated chunks.
const env = { ...process.env, MERIDIAN_E2E: "1", APP_ORIGIN: "http://127.0.0.1:4013",
  DATABASE_URL: "", REDIS_URL: "", AUTH_PEPPER: "", MFA_ENCRYPTION_KEY: "",
  ANTHROPIC_API_KEY: "", MAIL_API_KEY: "", NEXT_PUBLIC_REALTIME_URL: "" };
let child;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child?.kill(signal));
function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...args], { env, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Next exited with code ${code}`)));
  });
}
await run(["build"]);
await run(["start", "--hostname", "127.0.0.1", "--port", "4013"]);
