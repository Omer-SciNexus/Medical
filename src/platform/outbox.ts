import "server-only";
import { createHash } from "node:crypto";
import type { Transaction } from "./db";
import { outbox } from "./schema";

/** Derived from the event itself, so a retried transaction enqueues it exactly once. */
export function outboxKey(topic: string, resourceId: string) {
  const hex = createHash("sha256").update(`${topic}:${resourceId}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
// Payloads carry identifiers only. A worker re-reads authorized data when it dispatches.
export async function enqueueOutbox(tx: Transaction, event: { clinicId: string; topic: string; resourceId: string }) {
  await tx.insert(outbox).values({ clinicId: event.clinicId, topic: event.topic, resourceId: event.resourceId, idempotencyKey: outboxKey(event.topic, event.resourceId) })
    .onConflictDoNothing({ target: outbox.idempotencyKey });
}
