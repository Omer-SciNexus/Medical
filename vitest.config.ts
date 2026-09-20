import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)), "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)) };
export default defineConfig({ test: { projects: [
  { resolve: { alias }, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" } },
  { resolve: { alias }, test: { name: "integration", include: ["tests/integration/**/*.test.ts"], environment: "node", hookTimeout: 120_000, testTimeout: 30_000, fileParallelism: false } },
] } });
