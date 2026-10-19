import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
const exec = promisify(execFile);
describe("standalone process entry points", () => {
  for (const processName of ["worker", "realtime"]) it(`${processName} imports the real server modules without test aliases`, async () => {
    const result = await exec(process.execPath, ["--conditions=react-server", "--import", "tsx", `scripts/${processName}.ts`, "--check"], {
      env: { ...process.env, DATABASE_URL: "postgres://example:example@127.0.0.1/example", AUDIT_DATABASE_URL: "postgres://example:example@127.0.0.1/example",
        REDIS_URL: "redis://127.0.0.1:6379", AUTH_PEPPER: "startup-test-only-pepper-32-characters", APP_ORIGIN: "https://clinic.example" },
      windowsHide: true, timeout: 20_000,
    });
    expect(result.stdout).toContain("imports and configuration verified");
  }, 25_000);
});
