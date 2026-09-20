import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/modules/*/schema.ts", "./src/platform/schema.ts"],
  out: "./drizzle",
  strict: true,
});
