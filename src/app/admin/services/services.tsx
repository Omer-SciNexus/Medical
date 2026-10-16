"use client";

import * as React from "react";
import { useActionState } from "react";
import { Ban, BadgeCheck, CheckCircle2, Loader2, Plus, Receipt, Star } from "lucide-react";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { clinicalDate, money } from "@/lib/format";
import { idleAction } from "@/lib/action-state";
import { addServiceAction, setDefaultServiceAction, setServiceStateAction, settleInvoiceAction, voidInvoiceAction } from "@/app/admin/actions";

type Service = { id: string; code: string; name: string; amountMinor: number; currency: string; isDefault: boolean; active: boolean };
type Invoice = { id: string; encounterId: string; patientId: string; amountMinor: number; currency: string; status: string; createdAt: string; paidAt: string | null };
const METHODS = ["cash", "card", "transfer", "insurance"];

export function Services({ services, invoices, currency, timeZone }: { services: Service[]; invoices: Invoice[]; currency: string; timeZone: string }) {
  const [addState, addService, addPending] = useActionState(addServiceAction, idleAction);
  const [stateState, setState, statePending] = useActionState(setServiceStateAction, idleAction);
  const [defaultState, setDefault, defaultPending] = useActionState(setDefaultServiceAction, idleAction);
  const [payState, settle, payPending] = useActionState(settleInvoiceAction, idleAction);
  const [voidState, voidInvoice, voidPending] = useActionState(voidInvoiceAction, idleAction);
  const [settling, setSettling] = React.useState<string | null>(null);
  const [voiding, setVoiding] = React.useState<string | null>(null);
  const error = [addState, stateState, defaultState, payState, voidState].find((state) => state.error)?.error;
  const pending = addPending || statePending || defaultPending || payPending || voidPending;

  return <>
    {error ? <p className="field-error" role="alert" style={{ marginBottom: 14 }}>{error}</p> : null}
    <form action={addService} className="admin-form schedule-form" aria-busy={addPending}>
      <Field label="Code" id="code" error={addState.errors?.code?.[0]} hint="Capitals, digits and hyphens.">
        <Input id="code" name="code" defaultValue={addState.values?.code} placeholder="CONSULT-LONG" maxLength={20} required className="mono" /></Field>
      <Field label="Name" id="name" error={addState.errors?.name?.[0]}>
        <Input id="name" name="name" defaultValue={addState.values?.name} placeholder="Extended consultation" maxLength={120} required /></Field>
      <Field label={`Price (${currency})`} id="amountMajor" error={addState.errors?.amountMajor?.[0]}>
        <Input id="amountMajor" name="amountMajor" type="number" min="0" step="0.01" defaultValue={addState.values?.amountMajor} required className="mono" /></Field>
      <Field label="Default" id="isDefault" hint="What a visit is charged when nothing was added.">
        <label className="check-field"><input id="isDefault" name="isDefault" type="checkbox" /> Use as this clinic&rsquo;s default</label></Field>
      <div className="admin-form-actions">
        <Button type="submit" disabled={pending}>{addPending ? <Loader2 /> : <Plus />}Add service</Button>
        <span className="field-hint">Prices are stored in integer minor units, so nothing rounds on the way to an invoice.</span>
      </div>
    </form>

    <div className="specimen" style={{ marginBottom: 22 }}>
      <div className="specimen-topline"><strong>Services</strong><span>{services.filter((service) => service.active).length} active</span></div>
      {!services.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "32px 24px" }}>
        <p className="empty-state-icon"><Receipt /></p><h3>Nothing on the price list</h3><p>Add the first service above. A visit cannot be charged until one exists.</p>
      </div> : <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">This clinic&rsquo;s services</caption>
          <thead><tr><th scope="col">Code</th><th scope="col">Service</th><th scope="col">Price</th><th scope="col">State</th><th scope="col">Actions</th></tr></thead>
          <tbody>{services.map((service) => <tr key={service.id}>
            <td className="mono">{service.code}</td>
            <td>{service.name}{service.isDefault ? <Badge tone="accent" className="grant-flag"><Star />default</Badge> : null}</td>
            <td className="numeric">{money(service.amountMinor, service.currency)}</td>
            <td>{service.active ? <Badge tone="neutral">active</Badge> : <Badge tone="critical">withdrawn</Badge>}</td>
            <td><div className="row-actions">
              {!service.isDefault ? <form action={setDefault}><input type="hidden" name="serviceId" value={service.id} />
                <Button type="submit" size="small" variant="ghost" disabled={pending}><Star />Make default</Button></form> : null}
              <form action={setState}><input type="hidden" name="serviceId" value={service.id} /><input type="hidden" name="active" value={service.active ? "false" : "true"} />
                <Button type="submit" size="small" variant={service.active ? "ghost" : "secondary"} disabled={pending || service.isDefault}>
                  {service.active ? <><Ban />Withdraw</> : <><BadgeCheck />Restore</>}</Button></form>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="queue-footer"><span>One default per clinic, which a partial unique index enforces. A withdrawn service stays on invoices that already used it.</span></div>
    </div>

    <div className="specimen">
      <div className="specimen-topline"><strong>Invoices</strong><span>{invoices.filter((invoice) => invoice.status === "pending").length} unpaid</span></div>
      {!invoices.length ? <div className="state-panel" style={{ textAlign: "center", minHeight: 0, padding: "32px 24px" }}>
        <h3>No invoices yet</h3><p>An invoice is opened when a clinician adds a charge to a visit, and closed when the visit completes.</p>
      </div> : <div className="table-scroll">
        <table className="clinical-table">
          <caption className="sr-only">Invoices in this clinic</caption>
          <thead><tr><th scope="col">Raised</th><th scope="col">Patient</th><th scope="col">Total</th><th scope="col">State</th><th scope="col">Actions</th></tr></thead>
          <tbody>{invoices.map((invoice) => <tr key={invoice.id}>
            <td><time className="mono">{clinicalDate(invoice.createdAt, new Date(), timeZone)}</time></td>
            <td className="mono" title={invoice.patientId}>{invoice.patientId.slice(0, 8)}</td>
            <td className="numeric">{money(invoice.amountMinor, invoice.currency)}</td>
            <td><Badge tone={invoice.status === "paid" ? "accent" : invoice.status === "void" ? "neutral" : "high"}>{invoice.status}</Badge></td>
            <td>{invoice.status !== "pending" ? <span className="field-hint">{invoice.paidAt ? clinicalDate(invoice.paidAt, new Date(), timeZone) : "—"}</span>
              : settling === invoice.id ? <form action={settle} className="row-actions">
                <input type="hidden" name="chargeId" value={invoice.id} />
                <select name="method" className="input" defaultValue="card" aria-label="Payment method">{METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</select>
                <Button type="submit" size="small" disabled={pending}>{payPending ? <Loader2 /> : <CheckCircle2 />}Mark paid</Button>
                <Button type="button" size="small" variant="ghost" onClick={() => setSettling(null)}>Cancel</Button>
              </form>
              : voiding === invoice.id ? <form action={voidInvoice} className="row-actions">
                <input type="hidden" name="chargeId" value={invoice.id} />
                <Input name="reason" placeholder="Why is this being voided?" maxLength={300} required aria-label="Void reason" />
                <Button type="submit" size="small" variant="danger" disabled={pending}>{voidPending ? <Loader2 /> : <Ban />}Void</Button>
                <Button type="button" size="small" variant="ghost" onClick={() => setVoiding(null)}>Cancel</Button>
              </form>
              : <div className="row-actions">
                <Button type="button" size="small" variant="secondary" onClick={() => { setSettling(invoice.id); setVoiding(null); }}><CheckCircle2 />Settle</Button>
                <Button type="button" size="small" variant="ghost" onClick={() => { setVoiding(invoice.id); setSettling(null); }}><Ban />Void</Button>
              </div>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="queue-footer"><span>Patients appear as identifiers here. Settling or voiding an invoice is recorded against the patient like any other write.</span></div>
    </div>
  </>;
}
