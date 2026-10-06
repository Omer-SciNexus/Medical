"use client";

import * as React from "react";
import { useActionState } from "react";
import { CircleCheck, FileSignature, Loader2, PenLine, Receipt, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { Button, Field, Modal, Textarea } from "@/components/ui/primitives";
import { idleAction } from "@/lib/action-state";
import { amendNoteAction, completeVisitAction, draftNoteAction, saveNoteAction, signNoteAction } from "@/app/clinical/actions";

type Note = { id: string; version: number; revision: number; content: string; status: string; signedAt: string | null; amendmentReason: string | null };
type Encounter = { id: string; status: string; summary: string | null; publishedAt: string | null };
type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";
const AUTOSAVE_MS = 1200;

export function NoteEditor({ note, encounter, charge, fee, aiEnabled }: {
  note: Note; encounter: Encounter; charge: { amountMinor: number; currency: string } | null; fee: { amountMinor: number; currency: string }; aiEnabled: boolean;
}) {
  const [content, setContent] = React.useState(note.content);
  const [saveState, setSaveState] = React.useState<SaveState>("saved");
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [signOpen, setSignOpen] = React.useState(false);
  const [amendOpen, setAmendOpen] = React.useState(false);
  const revision = React.useRef(note.revision);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editable = note.status === "draft" && encounter.status === "in_progress";
  const signable = editable && content.trim().length >= 20;
  const [signState, sign, signPending] = useActionState(signNoteAction, idleAction);
  const [amendState, amend, amendPending] = useActionState(amendNoteAction, idleAction);
  const [completeState, complete, completePending] = useActionState(completeVisitAction, idleAction);
  const [draftState, requestDraft, draftPending] = useActionState(draftNoteAction, idleAction);

  // The server is the only source of truth for a save. Nothing is shown as saved until it confirms.
  const persist = React.useCallback(async (value: string) => {
    setSaveState("saving");
    const form = new FormData();
    form.set("encounterId", encounter.id); form.set("versionId", note.id);
    form.set("revision", String(revision.current)); form.set("content", value);
    const result = await saveNoteAction(idleAction, form);
    if (result.ok && result.revision) { revision.current = result.revision; setSavedAt(result.savedAt ?? Date.now()); setSaveState("saved"); }
    else setSaveState(result.code === "conflict" ? "conflict" : "error");
  }, [encounter.id, note.id]);

  function onChange(value: string) {
    setContent(value);
    if (!editable || saveState === "conflict") return;
    setSaveState("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(value), AUTOSAVE_MS);
  }
  React.useEffect(() => () => clearTimeout(timer.current), []);
  React.useEffect(() => {
    if (saveState !== "dirty" && saveState !== "error") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);
  React.useEffect(() => { if (draftState.draft) { setContent(draftState.draft); setSaveState("dirty"); } }, [draftState.draft]);

  const status = { saved: savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : "No unsaved changes",
    dirty: "Unsaved changes", saving: "Saving…", conflict: "Not saved", error: "Not saved" }[saveState];

  return <div className="note-editor">
    <div className="note-toolbar">
      <div><span className="eyebrow">Visit note &middot; version {note.version}</span>
        <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          {note.status === "draft" ? "Draft. Signing freezes this version." : note.status === "signed" ? "Signed and frozen. An amendment creates a linked version." : "Amended. The signed text above is retained."}
        </p></div>
      {aiEnabled && editable ? <form action={requestDraft}>
        <input type="hidden" name="encounterId" value={encounter.id} />
        <input type="hidden" name="observations" value={content} />
        <Button type="submit" variant="secondary" size="small" disabled={draftPending}>{draftPending ? <Loader2 /> : <Sparkles />} Draft with assistance</Button>
      </form> : null}
    </div>
    {draftState.error ? <p className="field-error" role="alert">{draftState.error}</p> : null}
    {aiEnabled && draftState.draft ? <p className="note-advisory"><TriangleAlert /> This draft was generated from your notes and the recorded observations. Review every line; you are signing it.</p> : null}

    <Textarea aria-label="Visit note" value={content} onChange={(event) => onChange(event.target.value)} readOnly={!editable} rows={16}
      className="note-textarea" aria-describedby="note-save-status" spellCheck />

    <div className="form-footer">
      <p className="save-status" id="note-save-status" aria-live="polite" data-state={saveState}>
        {saveState === "saving" ? <Loader2 className="spin" /> : saveState === "saved" ? <CircleCheck /> : <TriangleAlert />} {status}
      </p>
      {editable ? <Button type="button" disabled={!signable || signPending} onClick={() => setSignOpen(true)}><FileSignature /> Sign note</Button> : null}
      {note.status === "signed" && encounter.status === "in_progress" ? <Button type="button" variant="secondary" onClick={() => setAmendOpen(true)}><PenLine /> Amend</Button> : null}
    </div>
    {saveState === "conflict" ? <div className="note-conflict" role="alert">
      <TriangleAlert /><div><strong>This note was saved elsewhere after you opened it.</strong>
        <p>Your text here has not been written. Reload to continue from the current version, then reapply your changes.</p>
        <Button variant="secondary" size="small" onClick={() => window.location.reload()}><RefreshCw /> Reload note</Button></div>
    </div> : null}
    {saveState === "error" ? <p className="field-error" role="alert" style={{ marginTop: 8 }}>This change was not saved. Check your connection; your text is still here.</p> : null}
    {signState.error ? <p className="field-error" role="alert" style={{ marginTop: 8 }}>{signState.error}</p> : null}

    <Modal open={signOpen} onOpenChange={setSignOpen} title="Sign this visit note" description="Signing freezes this version of the note. Later corrections create a linked amendment with a recorded reason; the text you sign is never overwritten.">
      <div className="review-record"><span className="eyebrow">Version {note.version}</span><p>{content.trim().slice(0, 280)}{content.trim().length > 280 ? "…" : ""}</p></div>
      <form action={sign} className="dialog-actions">
        <input type="hidden" name="encounterId" value={encounter.id} /><input type="hidden" name="versionId" value={note.id} />
        <input type="hidden" name="revision" value={revision.current} /><input type="hidden" name="content" value={content} />
        <input type="hidden" name="dirty" value={String(saveState !== "saved")} />
        <Button type="button" variant="ghost" onClick={() => setSignOpen(false)}>Keep editing</Button>
        <Button type="submit" disabled={signPending}>{signPending ? <Loader2 /> : <FileSignature />} Sign and freeze</Button>
      </form>
    </Modal>

    <Modal open={amendOpen} onOpenChange={setAmendOpen} title="Amend the signed note" description="The signed version is retained unchanged. This creates a new linked version that records why the amendment was made.">
      <form action={amend}>
        <input type="hidden" name="encounterId" value={encounter.id} /><input type="hidden" name="versionId" value={note.id} />
        <input type="hidden" name="revision" value={note.revision} />
        <Field label="Reason for amendment" id="amend-reason" error={amendState.errors?.reason?.[0]} hint="At least 10 characters. This is recorded with the new version.">
          <Textarea id="amend-reason" name="reason" rows={2} required minLength={10} defaultValue={amendState.values?.reason} />
        </Field>
        <Field label="Amended note" id="amend-content" className="field-full">
          <Textarea id="amend-content" name="content" rows={8} required defaultValue={content} />
        </Field>
        {amendState.error ? <p className="field-error" role="alert">{amendState.error}</p> : null}
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={() => setAmendOpen(false)}>Cancel</Button>
          <Button type="submit" disabled={amendPending}>{amendPending ? <Loader2 /> : <PenLine />} Create amendment</Button>
        </div>
      </form>
    </Modal>

    {(note.status === "signed" || note.status === "amended") && encounter.status === "in_progress" ? <section className="complete-visit">
      <h3><Receipt /> Complete the visit</h3>
      <p className="muted">Completing records one charge, marks the appointment done and publishes the summary the patient reads. It cannot be undone from this screen.</p>
      <form action={complete}>
        <input type="hidden" name="encounterId" value={encounter.id} />
        <Field label="Patient visit summary" id="visit-summary" error={completeState.errors?.summary?.[0]} hint="Plain language, written by you. This is the text the patient sees.">
          <Textarea id="visit-summary" name="summary" rows={5} required minLength={20} defaultValue={completeState.values?.summary} />
        </Field>
        {completeState.error ? <p className="field-error" role="alert">{completeState.error}</p> : null}
        <div className="form-footer"><span className="save-status">Charge: {(fee.amountMinor / 100).toFixed(2)} {fee.currency}, recorded once per visit.</span>
          <Button type="submit" disabled={completePending}>{completePending ? <Loader2 /> : <CircleCheck />} Complete visit</Button></div>
      </form>
    </section> : null}

    {encounter.status === "completed" ? <section className="complete-visit" data-done="true">
      <h3><CircleCheck /> Visit completed</h3>
      <p className="muted">The summary is published to the patient. {charge ? `One charge of ${(charge.amountMinor / 100).toFixed(2)} ${charge.currency} was recorded.` : "No charge was found for this visit."}</p>
      {encounter.summary ? <div className="review-record"><span className="eyebrow">Published summary</span><p>{encounter.summary}</p></div> : null}
    </section> : null}
  </div>;
}
