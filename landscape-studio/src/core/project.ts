import type { CompanySettings, Project, SiteObject, ObjType, Pt } from './types.ts';
import { DEFAULT_ESTIMATE } from './estimate.ts';
import { defaultMaterial, defaultProps } from './assemblies.ts';
import { TYPE_LABEL } from './types.ts';

export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const today = () => new Date().toISOString().slice(0, 10);

export const DEFAULT_SETTINGS: CompanySettings = {
  appName: 'Landscape Intelligence Studio', company: '', licence: '', abn: '', phone: '', email: '', userName: 'Owner', role: 'owner',
};

export function newProject(name = 'New project'): Project {
  const now = new Date().toISOString();
  return {
    id: uid('prj'), schema: 1, name,
    customer: { id: uid('cus'), name: '', phone: '', email: '' },
    site: { address: '', suburb: '', council: '', lotAreaM2: null, access: 'easy', heritage: 'unknown', floodControlLot: 'unknown', bushfire: 'unknown', easements: 'unknown', nearWaterbody: 'unknown', conditions: '' },
    brief: { description: '', scope: '', budgetMin: null, budgetMax: null, preferredMaterials: '', targetCompletion: '', notes: '' },
    status: 'draft', objects: [], measurements: [], media: [], versions: [],
    estimate: structuredClone(DEFAULT_ESTIMATE), overrides: [], approvals: [], procurement: [], actuals: [], progress: [],
    audit: [{ at: now, by: 'system', action: 'Project created' }], workflow: {}, createdAt: now, updatedAt: now,
  };
}

export function newObject(type: ObjType, points: Pt[], existing: SiteObject[], layer: 'existing' | 'proposed' = 'proposed'): SiteObject {
  const props = defaultProps(type);
  const n = existing.filter(o => o.type === type).length + 1;
  const fixedExisting = type === 'boundary' || type === 'building' || type === 'feature' || type === 'fence';
  return {
    id: uid('obj'), type, name: `${TYPE_LABEL[type].replace(' (reference)', '')} ${n}`, layer: fixedExisting ? 'existing' : layer,
    points, confidence: 'estimated', props, materialId: defaultMaterial(type, props),
  };
}

export const STATUS_LABEL: Record<Project['status'], string> = {
  draft: 'Draft', concept: 'Concept', 'measurements-verified': 'Measurements verified', 'technical-review': 'Technical review required',
  approved: 'Approved by authorised reviewer', issued: 'Issued for construction',
};

export const STATUS_STAMP: Record<Project['status'], string> = {
  draft: 'DRAFT - NOT FOR CONSTRUCTION', concept: 'CONCEPT - NOT FOR CONSTRUCTION', 'measurements-verified': 'PRELIMINARY - NOT FOR CONSTRUCTION',
  'technical-review': 'TECHNICAL REVIEW REQUIRED - NOT FOR CONSTRUCTION', approved: 'APPROVED - PENDING ISSUE', issued: 'ISSUED FOR CONSTRUCTION',
};

export interface WorkflowStep { key: string; label: string; page: string; done: boolean; hint: string }

export function workflow(p: Project, priced: boolean): WorkflowStep[] {
  const proposed = p.objects.filter(o => o.layer === 'proposed');
  return [
    { key: 'customer', label: 'Customer', page: 'project', done: !!p.customer.name, hint: 'Add the customer name' },
    { key: 'site', label: 'Site', page: 'project', done: !!p.site.address && !!p.site.council, hint: 'Add the site address and council' },
    { key: 'capture', label: 'Capture', page: 'capture', done: p.media.length > 0, hint: 'Upload site photos or plans' },
    { key: 'measure', label: 'Measure', page: 'capture', done: p.measurements.some(m => m.confidence === 'verified'), hint: 'Record at least one verified measurement' },
    { key: 'draw', label: 'Draw', page: 'drawing', done: p.objects.length > 0, hint: 'Draw the site outline and existing features' },
    { key: 'design', label: 'Design', page: 'drawing', done: proposed.length > 0, hint: 'Add proposed walls, paving, gardens' },
    { key: 'verify', label: 'Verify', page: 'details', done: p.approvals.some(a => a.kind === 'measurements'), hint: 'Sign off measurements and review flags' },
    { key: 'estimate', label: 'Estimate', page: 'estimate', done: proposed.length > 0 && priced, hint: 'Price all materials and review rates' },
    { key: 'approve', label: 'Approve', page: 'documents', done: p.status === 'approved' || p.status === 'issued', hint: 'Record approvals and set status' },
    { key: 'procure', label: 'Procure', page: 'procurement', done: p.procurement.some(l => l.status !== 'to-order'), hint: 'Mark purchase lines as ordered' },
    { key: 'build', label: 'Build', page: 'performance', done: p.actuals.length > 0, hint: 'Record actual costs and hours' },
  ];
}
