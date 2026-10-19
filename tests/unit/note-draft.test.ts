import { describe, expect, it, vi } from "vitest";
import { NoteDraft } from "../../src/lib/note-draft";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
describe("note acknowledgements", () => {
  it("serializes slow saves and never acknowledges newer typing with an older response", async () => {
    const first = deferred<{ ok: boolean; revision: number }>();
    const second = deferred<{ ok: boolean; revision: number }>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const draft = new NoteDraft("Original", 1, save);
    const states: string[] = [];
    draft.subscribe(() => states.push(draft.getSnapshot().state));
    draft.edit("First edit"); const pending = draft.flush();
    draft.edit("Second edit"); const concurrent = draft.flush();
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve({ ok: true, revision: 2 }); await Promise.resolve();
    expect(draft.getSnapshot()).toMatchObject({ content: "Second edit", state: "saving" });
    expect(states).not.toContain("saved");
    expect(save).toHaveBeenLastCalledWith("Second edit", 2);
    second.resolve({ ok: true, revision: 3 });
    expect(await pending).toBe(true); expect(await concurrent).toBe(true);
    expect(draft.getSnapshot()).toMatchObject({ state: "saved", revision: 3, content: "Second edit" });
  });
  it("retains text on failure and retries at the acknowledged revision", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ok: true, revision: 2 });
    const draft = new NoteDraft("Original", 1, save); draft.edit("Keep this text");
    expect(await draft.flush()).toBe(false);
    expect(draft.getSnapshot()).toMatchObject({ content: "Keep this text", state: "error", revision: 1 });
    expect(await draft.flush()).toBe(true);
    expect(save).toHaveBeenLastCalledWith("Keep this text", 1);
  });
  it("does not retry a conflicting revision or lose subsequent local edits", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, code: "conflict" });
    const draft = new NoteDraft("Original", 1, save); draft.edit("Local text");
    expect(await draft.flush()).toBe(false); draft.edit("Preserve this too");
    expect(await draft.flush()).toBe(false); expect(save).toHaveBeenCalledTimes(1);
    expect(draft.getSnapshot()).toMatchObject({ content: "Preserve this too", state: "conflict" });
  });
});
