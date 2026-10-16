import type { Metadata } from "next";
import { ChevronRight, Home, Receipt, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app/shell";
import { getClinicSettings } from "@/modules/identity";
import { getPriceList, listInvoices } from "@/modules/billing";
import { clinicTimezone } from "@/lib/clinic-day";
import { requireActor } from "@/app/session";
import { Services } from "./services";

export const metadata: Metadata = { title: "Price list", robots: { index: false, follow: false } };

export default async function ServicesPage() {
  const actor = await requireActor(["admin"]);
  const breadcrumb = <><span className="breadcrumb-app"><Home /></span><span className="breadcrumb-first">Administration</span><ChevronRight /><span>Price list</span></>;
  const [clinic, priceList, invoices] = await Promise.all([
    getClinicSettings(actor).catch(() => null), getPriceList(actor, true).catch(() => null), listInvoices(actor).catch(() => []),
  ]);
  const shell = (children: React.ReactNode) =>
    <AppShell actor={actor} clinicName={clinic?.name ?? "Your clinic"} current="/admin/services" breadcrumb={breadcrumb}>{children}</AppShell>;

  if (!priceList) return shell(<div className="specimen"><div className="state-panel error-example">
    <p className="empty-state-icon"><TriangleAlert /></p><h3>The price list could not be read</h3>
    <p>Nothing was changed. Confirm the database is running, then reload this page.</p>
  </div></div>);

  return shell(<>
    <div className="section-header">
      <div className="section-heading"><div><span className="eyebrow icon-label"><Receipt /> Administration</span>
        <h2 style={{ marginTop: 6 }}>Price list</h2>
        <p className="section-description">What this clinic charges for. A visit is invoiced from whatever a clinician adds to it, or from the default service if nothing was added.</p></div></div>
    </div>
    <Services
      currency={clinic?.currency ?? "TRY"}
      timeZone={clinicTimezone()}
      services={priceList}
      invoices={invoices.map((invoice) => ({ id: invoice.id, encounterId: invoice.encounterId, patientId: invoice.patientId,
        amountMinor: invoice.amountMinor, currency: invoice.currency, status: invoice.status,
        createdAt: invoice.createdAt.toISOString(), paidAt: invoice.paidAt?.toISOString() ?? null }))}
    />
  </>);
}
