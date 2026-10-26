"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Plus, Receipt, Trash2 } from "lucide-react";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { money } from "@/lib/format";
import { idleAction } from "@/lib/action-state";
import { addChargeLineAction, removeChargeLineAction } from "@/app/clinical/actions";

type Line = { id: string; description: string; quantity: number; unitAmountMinor: number; amountMinor: number };
type Service = { id: string; code: string; name: string; amountMinor: number };

export function VisitCharges({ encounterId, open, currency, status, totalMinor, lines, services }: {
  encounterId: string; open: boolean; currency: string; status: string; totalMinor: number; lines: Line[]; services: Service[];
}) {
  const [addState, add, addPending] = useActionState(addChargeLineAction, idleAction);
  const [removeState, remove, removePending] = useActionState(removeChargeLineAction, idleAction);
  const error = [addState, removeState].find((state) => state.error)?.error;
  const pending = addPending || removePending;

  return <section className="chart-entry">
    <h3><Receipt /> What this visit is charged
      <Badge tone={status === "paid" ? "accent" : status === "void" ? "neutral" : "high"} className="grant-flag">{status}</Badge></h3>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {lines.length ? <div className="table-scroll">
      <table className="clinical-table">
        <caption className="sr-only">Charge lines on this visit</caption>
        <thead><tr><th scope="col">Service</th><th scope="col">Quantity</th><th scope="col">Unit</th><th scope="col">Amount</th>{open && status === "pending" ? <th scope="col">Actions</th> : null}</tr></thead>
        <tbody>{lines.map((line) => <tr key={line.id}>
          <td>{line.description}</td>
          <td className="numeric">{line.quantity}</td>
          <td className="numeric">{money(line.unitAmountMinor, currency)}</td>
          <td className="numeric">{money(line.amountMinor, currency)}</td>
          {open && status === "pending" ? <td><ConfirmForm action={remove} title={`Remove ${line.description} from this visit?`} description={`${money(line.amountMinor, currency)} will no longer be charged for this visit.`} confirmLabel="Remove charge">
            <input type="hidden" name="encounterId" value={encounterId} /><input type="hidden" name="lineId" value={line.id} />
            <Button type="submit" size="small" variant="ghost" disabled={pending}><Trash2 />Remove</Button></ConfirmForm></td> : null}
        </tr>)}</tbody>
        <tfoot><tr><th scope="row" colSpan={3}>Total</th><td className="numeric"><strong>{money(totalMinor, currency)}</strong></td>{open && status === "pending" ? <td /> : null}</tr></tfoot>
      </table>
    </div> : <p className="field-hint">Nothing added yet. Completing the visit charges this clinic&rsquo;s default service.</p>}

    {open && status === "pending" ? (services.length ? <form action={add} className="inline-form" aria-busy={addPending}>
      <input type="hidden" name="encounterId" value={encounterId} />
      <Field label="Add a service" id="serviceId" className="field-full">
        <select id="serviceId" name="serviceId" className="input" defaultValue={addState.values?.serviceId ?? services[0]?.id}>
          {services.map((service) => <option key={service.id} value={service.id}>{service.code} · {service.name} · {money(service.amountMinor, currency)}</option>)}
        </select></Field>
      <Field label="Quantity" id="quantity"><Input id="quantity" name="quantity" type="number" min={1} max={99} defaultValue={addState.values?.quantity ?? "1"} className="mono" /></Field>
      <Button type="submit" size="small" variant="secondary" disabled={pending}>{addPending ? <Loader2 /> : <Plus />}Add</Button>
    </form> : <p className="field-hint">This clinic&rsquo;s price list is empty. An administrator can add services under Price list.</p>) : null}
    <p className="field-hint">The total is maintained by the database from these lines, so it cannot drift from them.</p>
  </section>;
}
