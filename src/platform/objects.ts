import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * The object store, spoken to directly over S3's signature version 4.
 *
 * Presigning is an HMAC chain over a canonical request, which is small enough to do here and
 * keeps a multi-megabyte SDK out of a build that needs five of its calls. A presigned URL is
 * minted per request and expires in minutes, so no long-lived object URL ever exists; the
 * content type is signed into the upload URL, so a caller cannot store something other than
 * what was authorized.
 */
const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
const UNSIGNED = "UNSIGNED-PAYLOAD";

export function objectStoreConfigured() {
  return Boolean(process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY);
}
function settings() {
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  if (!endpoint || !accessKey || !secretKey) throw new Error("Object storage is not configured.");
  return { endpoint: new URL(endpoint), accessKey, secretKey, bucket: process.env.MINIO_BUCKET || "meridian-documents", region: process.env.MINIO_REGION || "us-east-1" };
}
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value, "utf8").digest();
// Every path segment is escaped, since a key may contain characters a URL would otherwise read.
const encodeKey = (key: string) => key.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");

function signingKey(secretKey: string, date: string, region: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), SERVICE), "aws4_request");
}
function presign(method: "GET" | "PUT" | "HEAD", key: string, options: { expiresInSeconds: number; contentType?: string; createOnly?: boolean }) {
  const { endpoint, accessKey, secretKey, bucket, region } = settings();
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = stamp.slice(0, 8);
  const scope = `${date}/${region}/${SERVICE}/aws4_request`;
  const headers: Record<string, string> = { host: endpoint.host,
    ...(options.contentType ? { "content-type": options.contentType } : {}),
    ...(options.createOnly ? { "if-none-match": "*" } : {}) };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const query = new URLSearchParams({
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${accessKey}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(options.expiresInSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  });
  // Query parameters are signed in sorted order, which URLSearchParams does not do for us.
  const canonicalQuery = [...query.entries()].sort(([a], [b]) => a < b ? -1 : 1)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&");
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const canonicalPath = `/${bucket}${key ? `/${encodeKey(key)}` : ""}`;
  const canonicalRequest = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, UNSIGNED].join("\n");
  const toSign = [ALGORITHM, stamp, scope, sha256(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(secretKey, date, region)).update(toSign, "utf8").digest("hex");
  return { url: `${endpoint.origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`, expiresAt: new Date(now.getTime() + options.expiresInSeconds * 1_000) };
}

export function presignUpload(key: string, contentType: string, expiresInSeconds = 300) {
  return presign("PUT", key, { expiresInSeconds, contentType, createOnly: true });
}
export function presignDownload(key: string, expiresInSeconds = 120) {
  return presign("GET", key, { expiresInSeconds });
}
/**
 * What actually landed in the store. The upload goes straight from the browser, so this is the
 * server's own check of the stored object's type and size before a document is made visible.
 */
export async function headObject(key: string) {
  const signed = presign("HEAD", key, { expiresInSeconds: 60 });
  const response = await fetch(signed.url, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) return undefined;
  return { byteSize: Number(response.headers.get("content-length") ?? 0), contentType: response.headers.get("content-type") ?? "" };
}
/** Creates the bucket if it is missing, so a fresh environment needs no manual setup. */
export async function ensureBucket() {
  const probe = presign("HEAD", "", { expiresInSeconds: 60 });
  const exists = await fetch(probe.url, { method: "HEAD", signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
  if (exists?.ok) return { created: false };
  const create = presign("PUT", "", { expiresInSeconds: 60 });
  const response = await fetch(create.url, { method: "PUT", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("Document bucket could not be created. Check storage configuration.");
  return { created: true };
}
export { settings as objectStoreSettings };
