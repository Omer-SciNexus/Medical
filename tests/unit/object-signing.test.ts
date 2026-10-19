import { beforeEach, describe, expect, it } from "vitest";
import { objectStoreConfigured, presignDownload, presignUpload } from "../../src/platform/objects";

const parse = (url: string) => new URL(url);

beforeEach(() => {
  process.env.MINIO_ENDPOINT = "http://127.0.0.1:9000";
  process.env.MINIO_ACCESS_KEY = "meridian-local";
  process.env.MINIO_SECRET_KEY = "local-object-store-only";
  process.env.MINIO_BUCKET = "meridian-documents";
  process.env.MINIO_REGION = "us-east-1";
});

describe("presigned object URLs", () => {
  const key = "00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000100/scan.pdf";

  it("carries everything S3 needs in the query, and the key in the path", () => {
    const signed = presignUpload(key, "application/pdf");
    const url = parse(signed.url);
    expect(url.origin).toBe("http://127.0.0.1:9000");
    expect(url.pathname).toBe(`/meridian-documents/${key}`);
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^meridian-local\/\d{8}\/us-east-1\/s3\/aws4_request$/);
    expect(url.searchParams.get("X-Amz-Date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
  it("signs the content type into an upload, so a caller cannot store something else", () => {
    const asPdf = presignUpload(key, "application/pdf");
    const asPng = presignUpload(key, "image/png");
    expect(parse(asPdf.url).searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host;if-none-match");
    expect(parse(asPdf.url).searchParams.get("X-Amz-Signature")).not.toBe(parse(asPng.url).searchParams.get("X-Amz-Signature"));
  });
  it("signs only the host for a download, and expires it sooner than an upload", () => {
    const download = presignDownload(key);
    expect(parse(download.url).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(Number(parse(download.url).searchParams.get("X-Amz-Expires"))).toBe(120);
    expect(Number(parse(presignUpload(key, "application/pdf").url).searchParams.get("X-Amz-Expires"))).toBe(300);
  });
  it("gives a different signature for a different key, secret or expiry", () => {
    const base = parse(presignDownload(key).url).searchParams.get("X-Amz-Signature");
    expect(parse(presignDownload(`${key}x`).url).searchParams.get("X-Amz-Signature")).not.toBe(base);
    expect(parse(presignDownload(key, 600).url).searchParams.get("X-Amz-Signature")).not.toBe(base);
    process.env.MINIO_SECRET_KEY = "a-different-secret";
    expect(parse(presignDownload(key).url).searchParams.get("X-Amz-Signature")).not.toBe(base);
  });
  it("escapes each path segment without escaping the separators", () => {
    const url = parse(presignDownload("clinic one/patient two/a file (1).pdf").url);
    expect(url.pathname).toBe("/meridian-documents/clinic%20one/patient%20two/a%20file%20%281%29.pdf");
  });
  it("reports whether storage is configured at all, and refuses to sign when it is not", () => {
    expect(objectStoreConfigured()).toBe(true);
    delete process.env.MINIO_SECRET_KEY;
    expect(objectStoreConfigured()).toBe(false);
    expect(() => presignDownload(key)).toThrow(/not configured/);
  });
});
