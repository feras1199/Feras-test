/**
 * QuickBooks Online (Australia) adapter boundary.
 *
 * Status: NOT CONNECTED. Nothing in ATLAS calls QuickBooks yet. The interface
 * is fixed so the real client can be dropped in after OAuth is set up and
 * tested against the sandbox company. Until then every method refuses rather
 * than pretending to succeed.
 */
export interface InvoiceDraft {
  customerName: string;
  customerEmail?: string;
  reference: string; // e.g. Q-2026-001 Deposit
  lines: { description: string; amountExGst: number; gstCode: "GST" | "FRE" }[];
  dueDate: string;
}

export interface AccountingAdapter {
  readonly provider: "quickbooks";
  status(): Promise<{ connected: boolean; detail: string }>;
  createDraftInvoice(d: InvoiceDraft): Promise<{ externalId: string }>;
  paymentStatus(externalId: string): Promise<{ paid: boolean; amountPaid: number }>;
}

export class NotConnectedQuickBooks implements AccountingAdapter {
  readonly provider = "quickbooks" as const;
  async status() {
    const hasKeys = !!(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
    return { connected: false, detail: hasKeys ? "Keys present, but OAuth sign-in and a sandbox test have not been done." : "No QuickBooks app keys configured." };
  }
  async createDraftInvoice(): Promise<{ externalId: string }> {
    throw new Error("QuickBooks is not connected. No invoice was created.");
  }
  async paymentStatus(): Promise<{ paid: boolean; amountPaid: number }> {
    throw new Error("QuickBooks is not connected.");
  }
}

export function accounting(): AccountingAdapter {
  return new NotConnectedQuickBooks();
}
