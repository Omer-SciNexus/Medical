"use client";

import * as React from "react";
import { useActionState } from "react";
import { CircleCheck, FileSignature, Loader2, PenLine, Receipt, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { Button, Field, Modal, Textarea } from "@/components/ui/primitives";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { money } from "@/lib/format";
import { NoteDraft } from "@/lib/note-draft";
import { idleAction } from "@/lib/action-state";
import { amendNoteAction, completeVisitAction, draftNoteAction, saveNoteAction, signNoteAction } from "@/app/clinical/actions";

type Note = { id: string; version: number; revision: number; content: string; status: string; signedAt: string | null; amendmentReason: string | null };
type Encounter = { id: string; status: string; summary: string | null; publishedAt: string | null };
const AUTOSAVE_MS = 1200;

export function NoteEditor({ note, encounter, charge, fee, aiEnabled }: {
  note: Note; encounter: Encounter; charge: { amountMinor: number; currency: string } | null; fee: { amountMinor: number; currency: string }; aiEnabled: boolean;
}) {
  const [draft] = React.useState(() => new NoteDraft(note.content, note.revision, async (content, revision) => {
    const form = new FormData();
    form.set("encounterId", encounter.id); form.set("versionId", note.id);
    form.set("revision", String(revision)); form.set("content", content);
    return saveNoteAction(idleAction, form);
  }));
  const snapshot = React.useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const { content, state: saveState, savedAt } = snapshot;
  const [preparing, setPreparing] = React.useState(false);
  const [signOpen, setSignOpen] = React.useState(false);
  const [amendOpen, setAmendOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editable = note.status === "draft" && encounter.status === "in_progress";
  const signable = editable && content.trim().length >= 20;
  const [signState, sign, signPending] = useActionState(signNoteAction, idleAction);
  const [amendState, amend, amendPending] = useActionState(amendNoteAction, idleAction);
  const [completeState, complete, completePending] = useActionState(completeVisitAction, idleAction);
  const [draftState, requestDraft, draftPending] = useActionState(draftNoteAction, idleAction);

  const onChange = React.useCallback((value: string) => {
    if (!editable) return;
    draft.edit(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void draft.flush(), AUTOSAVE_MS);
  }, [draft, editable]);
  async function reviewSignature() {
    clearTimeout(timer.current);
    setPreparing(true);
    try { if (await draft.flush()) setSignOpen(true); }
    finally { setPreparing(false); }
  }
  React.useEffect(() => () => clearTimeout(timer.current), []);
  React.useEffect(() => {
    if (saveState === "saved") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (anchor && !window.confirm("This note has unsaved changes. Leave without saving them?")) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate, true); };
  }, [saveState]);
  React.useEffect(() => { if (draftState.draft) onChange(draftState.draft); }, [draftState.draft, onChange]);

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
        <Button type="submit" variant="secondary" size="small" disabled={draftPending || preparing || signOpen || signPending}>{draftPending ? <Loader2 /> : <Sparkles />} Draft with assistance</Button>
      </form> : null}
    </div>
    {draftState.error ? <p className="field-error" role="alert">{draftState.error}</p> : null}
    {aiEnabled && editable ? <p className="field-hint">Drafting sends your note text and relevant chart facts to the configured AI service. Review the result before signing.</p> : null}
    {aiEnabled && draftState.draft ? <p className="note-advisory"><TriangleAlert /> This draft was generated from your notes and the recorded observations. Review every line; you are signing it.</p> : null}

    <Textarea aria-label="Visit note" value={content} onChange={(event) => onChange(event.target.value)} readOnly={!editable || preparing || signOpen || signPending || draftPending} rows={16}
      className="note-textarea" aria-describedby="note-save-status" spellCheck />

    <div className="form-footer">
      <p className="save-status" id="note-save-status" aria-live="polite" data-state={saveState}>
        {saveState === "saving" ? <Loader2 className="spin" /> : saveState === "saved" ? <CircleCheck /> : <TriangleAlert />} {status}
      </p>
      {editable ? <Button type="button" disabled={!signable || signPending || preparing || draftPending || saveState === "conflict"} onClick={() => void reviewSignature()}><FileSignature /> Sign note</Button> : null}
      {note.status === "signed" && encounter.status === "in_progress" ? <Button type="button" variant="secondary" onClick={() => setAmendOpen(true)}><PenLine /> Amend</Button> : null}
    </div>
    {saveState === "conflict" ? <div className="note-conflict" role="alert">
      <TriangleAlert /><div><strong>This note was saved elsewhere after you opened it.</strong>
        <p>Your text here has not been written. Copy it before reloading, then reapply your changes to the current version.</p>
        <Button variant="secondary" size="small" onClick={() => { if (window.confirm("Have you copied your unsaved text? Reloading will discard it.")) window.location.reload(); }}><RefreshCw /> Reload note</Button></div>
    </div> : null}
    {saveState === "error" ? <p className="field-error" role="alert" style={{ marginTop: 8 }}>This change was not saved. Check your connection; your text is still here. <Button type="button" size="small" variant="secondary" onClick={() => void draft.flush()}>Retry save</Button></p> : null}
    {signState.error ? <p className="field-error" role="alert" style={{ marginTop: 8 }}>{signState.error}</p> : null}

    <Modal open={signOpen} onOpenChange={setSignOpen} title="Sign this visit note" description="Signing freezes this version of the note. Later corrections create a linked amendment with a recorded reason; the text you sign is never overwritten.">
      <div className="review-record"><span className="eyebrow">Version {note.version}</span><p>{content.trim().slice(0, 280)}{content.trim().length > 280 ? "…" : ""}</p></div>
      <form action={sign} className="dialog-actions">
        <input type="hidden" name="encounterId" value={encounter.id} /><input type="hidden" name="versionId" value={note.id} />
        <input type="hidden" name="revision" value={snapshot.revision} /><input type="hidden" name="content" value={content} />
        <Button type="button" variant="ghost" onClick={() => setSignOpen(false)}>Keep editing</Button>
        <Button type="submit" disabled={signPending}>{signPending ? <Loader2 /> : <FileSignature />} Sign and freeze</Button>
      </form>
    </Modal>

    <Modal open={amendOpen} onOpenChange={setAmendOpen} title="Amend the signed note" description="The signed version is retained unchanged. This creates a new linked version that records why the amendment was made.">
      <form action={amend}>
        <input type="hidden" name="encounterId" value={encounter.id} /><input type="hidden" name="versionId" value={note.id} />
        <input type="hidden" name="revision" value={snapshot.revision} />
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

    {/* Only a signed current version is completable. After an amendment the current version
        is a draft again, so this section correctly disappears until it is signed. */}
    {note.status === "signed" && encounter.status === "in_progress" ? <section className="complete-visit">
      <h3><Receipt /> Complete the visit</h3>
      <p className="muted">Completing records one charge, marks the appointment done and publishes the summary the patient reads. It cannot be undone from this screen.</p>
      <ConfirmForm action={complete} title="Complete and publish this visit?" description={`The patient summary you entered will be published, an invoice of ${money(fee.amountMinor, fee.currency)} will be recorded, and this appointment will be marked complete. Review your summary before continuing.`} confirmLabel="Complete and publish">
        <input type="hidden" name="encounterId" value={encounter.id} />
        <Field label="Patient visit summary" id="visit-summary" error={completeState.errors?.summary?.[0]} hint="Plain language, written by you. This is the text the patient sees.">
          <Textarea id="visit-summary" name="summary" rows={5} required minLength={20} defaultValue={completeState.values?.summary} />
        </Field>
        {completeState.error ? <p className="field-error" role="alert">{completeState.error}</p> : null}
        <div className="form-footer"><span className="save-status">Invoice so far: {money(fee.amountMinor, fee.currency)}, charged once per visit.</span>
          <Button type="submit" disabled={completePending}>{completePending ? <Loader2 /> : <CircleCheck />} Complete visit</Button></div>
      </ConfirmForm>
    </section> : null}

    {encounter.status === "completed" ? <section className="complete-visit" data-done="true">
      <h3><CircleCheck /> Visit completed</h3>
      <p className="muted">The summary is published to the patient. {charge ? `An invoice of ${money(charge.amountMinor, charge.currency)} was recorded.` : "No invoice was found for this visit."}</p>
      {encounter.summary ? <div className="review-record"><span className="eyebrow">Published summary</span><p>{encounter.summary}</p></div> : null}
    </section> : null}
  </div>;
}
