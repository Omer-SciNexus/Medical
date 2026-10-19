import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { ensureBucket, headObject, presignDownload, presignUpload } from "../../src/platform/objects";
let store: StartedTestContainer;
beforeAll(async () => {
  store = await new GenericContainer("minio/minio:RELEASE.2025-04-22T22-12-26Z")
    .withEnvironment({ MINIO_ROOT_USER: "test-minio-user", MINIO_ROOT_PASSWORD: "test-minio-secret", MINIO_API_CORS_ALLOW_ORIGIN: "http://127.0.0.1:4013" })
    .withCommand(["server", "/data"]).withExposedPorts(9000).withWaitStrategy(Wait.forHttp("/minio/health/live", 9000)).start();
  process.env.MINIO_ENDPOINT = `http://${store.getHost()}:${store.getMappedPort(9000)}`;
  process.env.MINIO_ACCESS_KEY = "test-minio-user"; process.env.MINIO_SECRET_KEY = "test-minio-secret";
  process.env.MINIO_BUCKET = "document-tests";
  await ensureBucket();
}, 120_000);
afterAll(async () => { await store?.stop(); });
describe("real object store", () => {
  it("creates the bucket once and preserves a file against a second upload", async () => {
    expect(await ensureBucket()).toEqual({ created: false });
    const key = "clinic/patient/test.pdf";
    const upload = presignUpload(key, "application/pdf");
    const options = { method: "PUT", headers: { "content-type": "application/pdf", "if-none-match": "*" }, body: "synthetic document" };
    expect((await fetch(upload.url, options)).ok).toBe(true);
    expect(await headObject(key)).toEqual({ byteSize: 18, contentType: "application/pdf" });
    expect((await fetch(upload.url, { ...options, body: "replacement" })).status).toBe(412);
    expect((await fetch(upload.url, { ...options, headers: { "content-type": "application/pdf" } })).ok).toBe(false);
    expect(await (await fetch(presignDownload(key).url)).text()).toBe("synthetic document");
  });
  it("allows the configured browser origin and required conditional upload header", async () => {
    const response = await fetch(presignUpload("clinic/patient/cors.pdf", "application/pdf").url, {
      method: "OPTIONS", headers: { origin: "http://127.0.0.1:4013", "access-control-request-method": "PUT", "access-control-request-headers": "content-type,if-none-match" },
    });
    expect(response.ok).toBe(true);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4013");
  });
});
