import type { ObjType } from './types.ts';

export interface TypeStyle { stroke: string; fill?: string; w: number; dash?: number[]; label: string }

// Colours chosen to stay legible in print (greyscale-safe lineweights carry the hierarchy).
export const STYLE: Record<ObjType, TypeStyle> = {
  boundary: { stroke: '#b3261e', w: 0.5, dash: [6, 2, 1, 2], label: 'Site outline (reference only)' },
  building: { stroke: '#1f2933', fill: '#d5d9de', w: 0.7, label: 'Building' },
  feature: { stroke: '#6b7280', fill: '#eceef1', w: 0.35, dash: [3, 1.5], label: 'Existing feature' },
  paving: { stroke: '#7a5c2e', fill: '#ead9bd', w: 0.5, label: 'Paving' },
  garden: { stroke: '#2f6b3a', fill: '#cfe6c8', w: 0.5, label: 'Garden bed' },
  turf: { stroke: '#4c8a3f', fill: '#e2f1d4', w: 0.35, label: 'Turf' },
  deck: { stroke: '#8a5a2b', fill: '#e6c9a5', w: 0.5, label: 'Deck' },
  gravel: { stroke: '#8a8172', fill: '#ece6da', w: 0.35, label: 'Gravel' },
  steps: { stroke: '#4b5563', fill: '#dcdfe4', w: 0.5, label: 'Steps' },
  wall: { stroke: '#111827', w: 1.4, label: 'Retaining wall' },
  fence: { stroke: '#6b7280', w: 0.5, dash: [4, 1.5], label: 'Fence' },
  edging: { stroke: '#374151', w: 0.6, label: 'Garden edging' },
  drain: { stroke: '#1d5fa8', w: 0.6, dash: [5, 2], label: 'Drainage line (concept)' },
  cable: { stroke: '#b45309', w: 0.4, dash: [1.5, 1.5], label: 'Lighting cable (preliminary)' },
  dimension: { stroke: '#374151', w: 0.25, label: 'Dimension' },
  line: { stroke: '#374151', w: 0.35, label: 'Line' },
  tree: { stroke: '#22633a', fill: '#b9dcb4', w: 0.4, label: 'Tree' },
  plant: { stroke: '#2f6b3a', fill: '#9fd08f', w: 0.35, label: 'Plant group' },
  light: { stroke: '#b45309', fill: '#fde68a', w: 0.35, label: 'Light' },
  pit: { stroke: '#1d5fa8', fill: '#cfe1f5', w: 0.5, label: 'Drainage pit' },
  level: { stroke: '#111827', w: 0.3, label: 'Level marker' },
  note: { stroke: '#111827', w: 0.3, label: 'Note' },
};
