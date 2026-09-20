import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: root });
const boundaries = {
  meta: { type: "problem", schema: [], messages: { private: "Import another domain only through its public index.ts service exports." } },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    const own = filename.match(/\/src\/modules\/([^/]+)\//)?.[1];
    function inspect(node) {
      const source = node.source?.value;
      if (typeof source !== "string") return;
      const resolved = source.startsWith("@/") ? `${root}/src/${source.slice(2)}` : source.startsWith(".") ? path.resolve(path.dirname(context.filename), source) : source;
      const match = resolved.replaceAll("\\", "/").match(/\/src\/modules\/([^/]+)(?:\/(.*))?$/);
      if (match && match[1] !== own && match[2] && !/^index(?:\.[cm]?[jt]sx?)?$/.test(match[2])) context.report({ node, messageId: "private" });
    }
    return { ImportDeclaration: inspect, ExportNamedDeclaration: inspect, ExportAllDeclaration: inspect, ImportExpression: inspect };
  },
};
const config = [
  { ignores: [".next/**", "node_modules/**", ".npm-cache/**", ".artifacts/**", "test-results/**", "playwright-report/**", "next-env.d.ts", "drizzle/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { files: ["src/**/*.{ts,tsx}"], plugins: { meridian: { rules: { "domain-boundaries": boundaries } } }, rules: { "meridian/domain-boundaries": "error" } },
];
export default config;
