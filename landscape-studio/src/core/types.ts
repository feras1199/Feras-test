// Central data model. Everything else (drawing, quantities, estimate, exports)
// derives from these structures. Lengths are metres unless a field name says mm.

export type Pt = { x: number; y: number };

export type Confidence = 'verified' | 'estimated' | 'unknown';

export type MeasureMethod =
  | 'tape' | 'laser' | 'survey' | 'plan' | 'scan' | 'photo-estimate' | 'aerial' | 'assumed';

export interface Measurement {
  id: string;
  label: string;
  value: number | null; // metres
  method: MeasureMethod;
  source: string; // who / what document
  confidence: Confidence;
  date: string; // ISO date
  verifiedBy?: string;
  note?: string;
  /** Optional link to the distance between two vertices (an edge or a diagonal) or to a parameter, so drawing and measurement can be cross-checked. */
  link?: { objectId: string; a: number; b: number } | { objectId: string; prop: string };
}

export type ObjType =
  | 'boundary' | 'building' | 'feature' | 'paving' | 'garden' | 'turf' | 'deck' | 'gravel' | 'steps'
  | 'wall' | 'fence' | 'edging' | 'drain' | 'cable' | 'dimension' | 'line'
  | 'tree' | 'plant' | 'light' | 'pit' | 'level' | 'note';

export type GeomKind = 'area' | 'line' | 'point';

export interface SiteObject {
  id: string;
  type: ObjType;
  name: string;
  layer: 'existing' | 'proposed';
  points: Pt[];
  locked?: boolean;
  hidden?: boolean;
  materialId?: string;
  confidence: Confidence; // of the geometry itself
  props: Record<string, any>;
}

export type Unit = 'each' | 'm2' | 'm3' | 't' | 'lm' | 'roll' | 'bag' | 'hr' | 'day' | 'load' | 'item';

export type PriceStatus = 'verified' | 'placeholder' | 'quote-required' | 'outdated';

export interface Material {
  id: string;
  name: string;
  category: string;
  supplierId: string;
  manufacturer?: string;
  unit: Unit; // unit of sale
  price: number | null; // as listed by the supplier
  gstInclusive: boolean;
  priceStatus: PriceStatus;
  verifiedDate?: string;
  sourceUrl?: string;
  note?: string;
  /** Product dimensions in mm (length, width/height on face, thickness). */
  dims?: { l?: number; w?: number; t?: number };
  /** For rolls / lengths: metres per unit of sale. */
  lengthM?: number;
  /** Width in metres for sheet goods (geofabric). */
  widthM?: number;
  /** Bag size in kg where relevant. */
  bagKg?: number;
  /** Bulk density t/m3 used to convert volume to mass. Always an explicit, editable assumption. */
  density?: number;
  densitySource?: string;
  /** Must be bought in multiples of this many units (pack / pallet). */
  packSize?: number;
  minOrder?: number;
  /** Smallest sale increment in the unit of sale (e.g. 0.5 t). Defaults: 0.5 for t/m3, 1 otherwise. */
  increment?: number;
  /** m2 covered per unit of sale, from the product datasheet (jointing sand, sealers). */
  coverageM2?: number;
  slip?: string;
  colour?: string;
  finish?: string;
  /** Materials sharing a group are functional substitutes. */
  group?: string;
  tier?: 'economy' | 'balanced' | 'premium';
  availability?: string;
  history?: { date: string; price: number | null; note?: string }[];
}

export interface Supplier {
  id: string;
  name: string;
  region: string;
  url?: string;
  /** Flat delivery allowance per order, $ inc GST. null = unknown. */
  deliveryFee: number | null;
  deliveryStatus: PriceStatus;
  note?: string;
}

export interface ExtraLine {
  id: string;
  category: 'equipment' | 'subcontract' | 'disposal' | 'delivery' | 'other';
  desc: string;
  qty: number;
  unit: string;
  rate: number; // ex GST
  assumption: boolean;
}

export interface EstimateSettings {
  rates: { skilled: number; general: number; supervisor: number };
  /** hours per unit, keyed by activity. All are editable assumptions. */
  productivity: Record<string, number>;
  /** Share of labour hours done by skilled labour (rest general). */
  skilledShare: number;
  supervisionPct: number; // supervisor hours as % of crew hours
  accessFactor: number; // 1 = easy access; >1 slows labour
  overheadPct: number;
  contingencyPct: number;
  markupPct: number; // on cost (after overhead + contingency)
  gstPct: number;
  bulkingFactor: number; // excavated volume increase for disposal
  extras: ExtraLine[];
}

export interface Override {
  key: string; // QtyLine key
  qty: number;
  reason: string;
  by: string;
  date: string;
}

export interface Approval {
  id: string;
  scope: string; // e.g. object id or 'project'
  kind: 'measurements' | 'engineering' | 'issue';
  reviewer: string;
  role: string;
  credential: string; // e.g. registration no. as entered by the reviewer (not validated by the system)
  reference: string; // drawing / report reference
  date: string;
  note?: string;
}

export type ProjectStatus =
  | 'draft' | 'concept' | 'measurements-verified' | 'technical-review' | 'approved' | 'issued';

export interface ActualLine { category: string; estimated: number; actual: number; hoursEst?: number; hoursAct?: number; note?: string }

export interface MediaRef {
  id: string;
  name: string;
  kind: 'photo' | 'aerial' | 'plan' | 'scan' | 'document';
  mime: string;
  size: number;
  addedAt: string;
  note?: string;
  /** User- or AI-tagged features on the image. Never treated as verified geometry. */
  tags?: { id: string; x: number; y: number; label: string; type: string; origin: 'user' | 'ai-live' | 'ai-simulated'; confirmed: boolean }[];
}

export interface Underlay { mediaId: string; x: number; y: number; mPerPx: number; opacity: number; calibrated: boolean; w: number; h: number }

export interface DesignVersion { id: string; name: string; date: string; note?: string; objects: SiteObject[] }

export interface AuditEntry { at: string; by: string; action: string; detail?: string }

export interface PoLine { key: string; status: 'to-order' | 'ordered' | 'delivered'; note?: string }

export interface Project {
  id: string;
  schema: 1;
  name: string;
  synthetic?: boolean;
  customer: { id: string; name: string; phone: string; email: string; airtableId?: string };
  site: {
    address: string; suburb: string; council: string; lotAreaM2: number | null;
    access: 'easy' | 'restricted' | 'difficult';
    heritage: 'yes' | 'no' | 'unknown';
    floodControlLot: 'yes' | 'no' | 'unknown';
    bushfire: 'yes' | 'no' | 'unknown';
    easements: 'yes' | 'no' | 'unknown';
    nearWaterbody: 'yes' | 'no' | 'unknown';
    conditions: string;
  };
  brief: { description: string; scope: string; budgetMin: number | null; budgetMax: number | null; preferredMaterials: string; targetCompletion: string; notes: string };
  status: ProjectStatus;
  objects: SiteObject[];
  measurements: Measurement[];
  media: MediaRef[];
  underlay?: Underlay;
  versions: DesignVersion[];
  estimate: EstimateSettings;
  overrides: Override[];
  approvals: Approval[];
  procurement: PoLine[];
  /** Project-level price allowances for items with no catalogue price ($ per unit of sale, inc GST). Always shown as assumptions. */
  priceAssumptions?: Record<string, { price: number; note: string }>;
  actuals: ActualLine[];
  progress: { date: string; note: string; by: string }[];
  audit: AuditEntry[];
  workflow: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface QtyLine {
  key: string;
  objectId: string;
  objectName: string;
  component: string;
  kind: 'material' | 'labour' | 'earthworks';
  materialId?: string;
  formula: string;
  inputs: Record<string, string>;
  assumptions: string[];
  net: number | null; // null = cannot be calculated (missing input)
  unit: Unit;
  wastePct: number;
  gross: number | null;
  purchaseUnit?: Unit;
  purchaseQty?: number | null;
  purchaseNote?: string;
  source: string;
  overridden?: Override;
  warning?: string;
  activity?: string; // for labour lines
}

export interface CompanySettings {
  appName: string;
  company: string;
  licence: string; // entered by user, never invented
  abn: string;
  phone: string;
  email: string;
  userName: string;
  role: 'owner' | 'estimator' | 'crew' | 'reviewer';
}

export const GEOM: Record<ObjType, GeomKind> = {
  boundary: 'area', building: 'area', feature: 'area', paving: 'area', garden: 'area', turf: 'area',
  deck: 'area', gravel: 'area', steps: 'area',
  wall: 'line', fence: 'line', edging: 'line', drain: 'line', cable: 'line', dimension: 'line', line: 'line',
  tree: 'point', plant: 'point', light: 'point', pit: 'point', level: 'point', note: 'point',
};

export const TYPE_LABEL: Record<ObjType, string> = {
  boundary: 'Site boundary (reference)', building: 'Building', feature: 'Existing feature', paving: 'Paving',
  garden: 'Garden bed', turf: 'Turf', deck: 'Deck', gravel: 'Gravel area', steps: 'Steps',
  wall: 'Retaining wall', fence: 'Fence', edging: 'Garden edging', drain: 'Drainage line', cable: 'Lighting cable',
  dimension: 'Dimension', line: 'Line', tree: 'Tree', plant: 'Plant group', light: 'Light', pit: 'Drainage pit',
  level: 'Level marker', note: 'Note',
};
