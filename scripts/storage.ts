import { ensureBucket } from "../src/platform/objects";
await ensureBucket();
console.log("Document bucket is ready.");
