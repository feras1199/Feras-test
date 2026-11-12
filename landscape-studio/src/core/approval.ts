import type { CompanySettings, Project } from './types.ts';
import type { Estimate } from './estimate.ts';

// Status gate. Customer selection is a commercial choice only; it never stands in for
// engineering, council, boundary, supplier, drainage or electrical approval.

export const STATUS_ORDER: Project['status'][] = ['draft', 'concept', 'customer-selected', 'measurements-verified', 'technical-review', 'approved', 'issued'];

export const CUSTOMER_APPROVAL_MEANS = 'The customer chose a design direction, materials and budget scenario.';
export const CUSTOMER_APPROVAL_NOT = ['Engineering approval', 'Council approval', 'Boundary confirmation', 'Supplier stock confirmation', 'Drainage approval', 'Electrical approval'];

/** Returns null when allowed, otherwise the reason. */
export function statusChangeError(p: Project, to: Project['status'], role: CompanySettings['role'], blockers: string[]): string | null {
  if (role === 'crew') return 'The crew role cannot change project status.';
  if (to === 'concept' && !(p.proposals?.length)) return 'Generate design concepts first (Visual Concepts).';
  if (to === 'customer-selected' && !p.proposals?.some(x => x.selection)) return 'Record which concept the customer selected first.';
  if (to === 'measurements-verified' && !p.approvals.some(a => a.kind === 'measurements')) return 'Record a measurement sign-off first.';
  if (to === 'approved' || to === 'issued') {
    if (role !== 'reviewer') return 'Only a user in the "Authorised reviewer" role can approve or issue for construction (Settings → Current user).';
    if (blockers.length) return `Resolve ${blockers.length} open technical item(s) first: ${blockers[0]}`;
    if (to === 'issued' && p.status !== 'approved') return 'Approve the project before issuing it for construction.';
  }
  return null;
}

/** A final quotation needs every selected item priced and measured. */
export function quoteBlockers(e: Estimate): string[] {
  return e.flags.filter(f => /No price|Quantity incomplete/.test(f));
}
