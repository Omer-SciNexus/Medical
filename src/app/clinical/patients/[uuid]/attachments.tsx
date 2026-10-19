"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Paperclip, Upload } from "lucide-react";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { clinicalDate } from "@/lib/format";
import { confirmUploadAction, openDocumentAction, startUploadAction } from "@/app/clinical/actions";

type Document = { id: string; kind: string; filename: string; contentType: string; byteSize: number; createdAt: string };
const KINDS = ["result", "consent", "referral", "letter", "other"];
const size = (bytes: number) => bytes < 1_048_576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;

export function Attachments({ patientId, documents, configured, timeZone }: {
  patientId: string; documents: Document[]; configured: boolean; timeZone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState("result");
  const file = React.useRef<HTMLInputElement>(null);

  /**
   * The file goes straight to the object store under a URL that is signed for this one upload,
   * so it never passes through the application. The server then checks what landed before the
   * document joins the chart.
   */
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    const chosen = file.current?.files?.[0];
    if (!chosen) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const ticket = await startUploadAction({ patientId, kind, filename: chosen.name, contentType: chosen.type, byteSize: chosen.size });
      if (!ticket.ok) { setError(ticket.error); return; }
      const sent = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "content-type": ticket.contentType, "if-none-match": "*" }, body: chosen });
      if (!sent.ok) { setError("The file could not be stored. Try again."); return; }
      const confirmed = await confirmUploadAction(ticket.documentId);
      if (!confirmed.ok) { setError(confirmed.error); return; }
      setNotice(`${confirmed.filename} is on the chart.`);
      router.refresh();
      if (file.current) file.current.value = "";
    } catch { setError("The upload could not finish. Check your connection and try again."); } finally { setBusy(false); }
  }
  async function open(documentId: string) {
    setError(null);
    const link = await openDocumentAction(documentId);
    if (!link.ok) { setError(link.error); return; }
    window.open(link.url, "_blank", "noopener,noreferrer");
  }

  return <section className="specimen" style={{ marginTop: 20 }}>
    <div className="specimen-topline"><strong>Attachments</strong><span>{documents.length} on file</span></div>
    {!configured ? <div className="state-panel" style={{ minHeight: 0, padding: 24 }}>
      <p><Paperclip /> Document storage is not configured for this deployment, so nothing can be attached here.</p>
    </div> : <>
      {error ? <p className="field-error" role="alert" style={{ padding: "12px 18px 0" }}>{error}</p> : null}
      {notice ? <p className="field-hint" role="status" style={{ padding: "12px 18px 0" }}>{notice}</p> : null}
      <form onSubmit={upload} className="admin-form" style={{ gridTemplateColumns: "180px minmax(0, 1fr) auto", border: 0, marginBottom: 0 }} aria-busy={busy}>
        <Field label="What is it" id="kind">
          <select id="kind" className="input" value={kind} onChange={(event) => setKind(event.target.value)}>
            {KINDS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select></Field>
        <Field label="File" id="file" hint="PDF, PNG, JPEG or TIFF, up to 25 MB.">
          <Input id="file" type="file" ref={file} accept="application/pdf,image/png,image/jpeg,image/tiff" required /></Field>
        <div><Button type="submit" disabled={busy}>{busy ? <Loader2 /> : <Upload />}Attach</Button></div>
      </form>
    </>}
    {documents.length ? <div className="table-scroll">
      <table className="clinical-table">
        <caption className="sr-only">Documents attached to this chart</caption>
        <thead><tr><th scope="col">Added</th><th scope="col">File</th><th scope="col">Kind</th><th scope="col">Size</th><th scope="col">Actions</th></tr></thead>
        <tbody>{documents.map((document) => <tr key={document.id}>
          <td><time className="mono">{clinicalDate(document.createdAt, new Date(), timeZone)}</time></td>
          <td>{document.filename}</td>
          <td><Badge tone="neutral">{document.kind}</Badge></td>
          <td className="numeric">{size(document.byteSize)}</td>
          <td><Button type="button" size="small" variant="ghost" onClick={() => open(document.id)}><FileText />Open</Button></td>
        </tr>)}</tbody>
      </table>
    </div> : null}
    <div className="queue-footer"><span>Opening an attachment is a chart read: it is authorized, recorded, and the link it produces lasts two minutes.</span></div>
  </section>;
}
