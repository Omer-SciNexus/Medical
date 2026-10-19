export type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";
export type DraftSnapshot = { content: string; revision: number; state: SaveState; savedAt: number | null };
type SaveResult = { ok?: boolean; revision?: number; savedAt?: number; code?: string };

/** One writer per editor. An acknowledgement belongs to the content sent, never to later typing. */
export class NoteDraft {
  private snapshot: DraftSnapshot;
  private savedContent: string;
  private pending?: Promise<boolean>;
  private listeners = new Set<() => void>();
  constructor(content: string, revision: number, private save: (content: string, revision: number) => Promise<SaveResult>) {
    this.savedContent = content;
    this.snapshot = { content, revision, state: "saved", savedAt: null };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<DraftSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
  edit(content: string) {
    this.update({ content, state: this.snapshot.state === "conflict" ? "conflict" : this.pending ? "saving" : content === this.savedContent ? "saved" : "dirty" });
  }
  flush(): Promise<boolean> {
    if (this.pending) return this.pending;
    if (this.snapshot.state === "conflict") return Promise.resolve(false);
    this.pending = this.drain().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async drain() {
    while (this.snapshot.content !== this.savedContent) {
      const content = this.snapshot.content;
      this.update({ state: "saving" });
      try {
        const result = await this.save(content, this.snapshot.revision);
        if (!result.ok || !result.revision) {
          this.update({ state: result.code === "conflict" ? "conflict" : "error" });
          return false;
        }
        this.savedContent = content;
        this.update({ revision: result.revision, savedAt: result.savedAt ?? Date.now() });
      } catch {
        this.update({ state: "error" });
        return false;
      }
    }
    this.update({ state: "saved" });
    return true;
  }
}
