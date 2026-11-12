import type { CompanySettings, Project, SiteObject } from './types.ts';
import { centroid, distPointToPolyline, polygonArea, polylineLength } from './geometry.ts';
import { GEOM } from './types.ts';

// Rule-based checks against published NSW sources. These are screening aids only:
// passing a check here is NOT planning approval, certification or engineering sign-off.

export type CStatus = 'verified' | 'potential' | 'insufficient' | 'na';

export const STATUS_LABEL: Record<CStatus, string> = {
  verified: 'Verified against available evidence',
  potential: 'Potential issue requiring review',
  insufficient: 'Insufficient information',
  na: 'Not applicable',
};

export interface Check {
  id: string; title: string; rule: string; jurisdiction: string;
  sourceName: string; sourceUrl: string; effective: string; checked: string;
  parameter: string; status: CStatus; result: string; uncertainty: string; humanReview: string; objectId?: string;
}

export const CHECKED = '2026-11-11';

const SRC = {
  licence: { n: 'NSW Government: Structural landscaping work', u: 'https://www.nsw.gov.au/business-and-economy/licences-and-credentials/building-and-trade-licences-and-registrations/structural-landscaping-work', e: 'Page updated 23 June 2026' },
  contracts: { n: 'NSW Government: Contracts for residential building work', u: 'https://www.nsw.gov.au/housing-and-construction/building-or-renovating-a-home/preparing/contracts', e: 'Page dated 27 June 2025' },
  hbcf: { n: 'SIRA: Contracting and HBC insurance guidance for landscaping projects', u: 'https://www.sira.nsw.gov.au/home-building-compensation/home-building-compensation-for-builders-and-tradies/contracting-and-home-building-compensation-guidance-for-landscaping-projects', e: 'Page dated 31 March 2026' },
  categories: { n: 'NSW Government: Categories and classes of building and trade work', u: 'https://www.nsw.gov.au/business-and-economy/licences-and-credentials/building-and-trade-licences-and-registrations/categories-of-work', e: 'Page dated 5 September 2024' },
  earthworks: { n: 'NSW Planning Portal: Earthworks, retaining walls and structural supports (exempt development); Codes SEPP 2008 Pt 2 Div 1 Subdiv 15 (cl 2.29 to 2.30)', u: 'https://www.planningportal.nsw.gov.au/development-and-assessment/planning-approval-pathways/exempt-development/earthworks-retaining-walls-and-structural-supports', e: 'Codes SEPP as in force; clause text not retrieved in full during research' },
  decks: { n: 'NSW Planning Portal: Balconies, decks and patios (exempt development); Codes SEPP Subdiv 6', u: 'https://www.planningportal.nsw.gov.au/development-and-assessment/planning-approval-pathways/exempt-development/balconies-decks-and-patios', e: 'Page updated 23 March 2026' },
  paving: { n: 'NSW Planning: Driveways, pathways and paving (exempt development); Codes SEPP Subdiv 14 and 28', u: 'https://planning.nsw.gov.au/the-planning-system/development-assessment/planning-approval-pathways/development-types/driveways-pathways-and-paving', e: 'Page updated 23 March 2026' },
  as4678: { n: 'NCC 2019 Vol Two Part 3.1.2 explanatory information (AS 4678 Earth-retaining structures)', u: 'https://ncc.abcb.gov.au/editions/2019-a1/ncc-2019-volume-two-amendment-1/part-31-site-preparation/part-312-earth-retaining', e: 'NCC 2019 Amdt 1; AS 4678-2002' },
  versawall: { n: 'Adbri Masonry: Versawall product page', u: 'https://www.adbrimasonry.com.au/products/versawall', e: 'Page dated 30 April 2025' },
  as4970: { n: 'AS 4970:2025 Protection of trees on development sites (summary via Ecological Consultants Association of Victoria)', u: 'https://ecavic.org.au/industry-update-18th-june-2025', e: 'AS 4970:2025 published 30 May 2025' },
  hb198: { n: 'SA HB 198:2014 Table 3B and AS 4586-2013 (summary via ACO)', u: 'https://acodrain.com.au/understanding-slip-resistance', e: 'HB 198:2014; AS 4586-2013' },
  byda: { n: 'Before You Dig Australia', u: 'https://www.byda.com.au', e: 'Current service' },
};

const base = (id: string, title: string, s: { n: string; u: string; e: string }, jurisdiction = 'New South Wales') =>
  ({ id, title, jurisdiction, sourceName: s.n, sourceUrl: s.u, effective: s.e, checked: CHECKED });

const tri = (v: 'yes' | 'no' | 'unknown') => v;

export function evaluateCompliance(project: Project, priceInc: number | null, settings: CompanySettings): Check[] {
  const out: Check[] = [];
  const proposed = project.objects.filter(o => o.layer === 'proposed');
  const has = (t: SiteObject['type']) => proposed.some(o => o.type === t);
  const site = project.site;
  const structural = proposed.some(o => ['wall', 'paving', 'deck', 'steps', 'fence'].includes(o.type));

  // 1. Contractor licence
  out.push({
    ...base('licence', 'Contractor licence (structural landscaping)', SRC.licence),
    rule: 'A contractor licence is required to do, advertise or contract for residential building work, including structural landscaping, valued at more than $5,000 in labour and materials (including GST).',
    parameter: `Estimated contract value: ${priceInc == null ? 'not yet estimated' : '$' + priceInc.toFixed(0) + ' inc GST'}; structural work in scope: ${structural ? 'yes' : 'no'}`,
    status: !structural ? 'na' : priceInc == null ? 'insufficient' : priceInc > 5000 ? (settings.licence ? 'verified' : 'potential') : 'verified',
    result: !structural ? 'No structural landscaping elements in the proposed design.' : priceInc == null ? 'Complete the estimate to check the threshold.' : priceInc > 5000 ? (settings.licence ? `Above $5,000. Licence number ${settings.licence} is recorded in Settings.` : 'Above $5,000. No licence number recorded in Settings.') : 'At or below the $5,000 threshold on the current estimate.',
    uncertainty: 'The licence number is as entered by the user. It is not checked against the NSW public register by this software.',
    humanReview: 'Confirm the licence is current and covers structural landscaping (NSW licence check).',
  });

  // 2. Contract and insurance
  out.push({
    ...base('contract', 'Written contract and Home Building Compensation cover', SRC.hbcf),
    rule: 'Residential building work over $5,000 inc GST needs a compliant written contract; over $20,000 inc GST needs a large-job contract and HBCF insurance before work starts or any deposit is taken. Maximum deposit is 10%.',
    parameter: `Estimated contract value: ${priceInc == null ? 'not yet estimated' : '$' + priceInc.toFixed(0) + ' inc GST'}`,
    status: !structural ? 'na' : priceInc == null ? 'insufficient' : priceInc > 5000 ? 'potential' : 'verified',
    result: !structural ? 'No residential building work identified.' : priceInc == null ? 'Complete the estimate.' : priceInc > 20000 ? 'Over $20,000: large-job contract and HBCF certificate required before starting or taking payment.' : priceInc > 5000 ? 'Between $5,000 and $20,000: small-job written contract required.' : 'At or below $5,000 on the current estimate.',
    uncertainty: 'Soft landscaping (turf, plants, soil, mulch) is not residential building work and may be contracted separately; the split is a business decision. Value thresholds apply to the total of related contracts.',
    humanReview: 'Business owner to confirm contract type and insurance. See also ' + SRC.contracts.u,
  });

  // 3. Per-wall checks
  for (const w of proposed.filter(o => o.type === 'wall')) {
    const hr = w.props.retainedHeight ?? w.props.exposedHeight;
    const h = hr == null || hr === '' ? null : Number(hr);
    const flags = [site.heritage, site.floodControlLot, site.nearWaterbody].map(tri);
    let status: Check['status'], result: string;
    if (h == null) { status = 'insufficient'; result = 'Retained height not recorded.'; }
    else if (h > 0.6) { status = 'potential'; result = `Retained height ${h.toFixed(2)} m exceeds the 600 mm cut/fill limit for exempt earthworks and retaining walls. A complying development certificate or development application is likely to be needed.`; }
    else if (flags.includes('yes')) { status = 'potential'; result = 'Site is recorded as a heritage item, flood control lot or near a natural waterbody. Exempt development is unlikely to apply.'; }
    else if (flags.includes('unknown')) { status = 'insufficient'; result = `Height ${h.toFixed(2)} m is within 600 mm, but heritage, flood control lot or waterbody status is unknown.`; }
    else { status = 'insufficient'; result = `Height ${h.toFixed(2)} m is within 600 mm and the recorded site attributes do not rule out exempt development. Remaining standards in clause 2.30 have not been checked automatically.`; }
    out.push({
      ...base(`wall-exempt:${w.id}`, `Planning pathway: ${w.name}`, SRC.earthworks), objectId: w.id,
      rule: 'Exempt earthworks and retaining walls must (among other standards) not involve cut or fill of more than 600 mm below or above existing ground level, must not be on a flood control lot or a heritage item, and must be set back from natural waterbodies. All standards in clause 2.30 must be met.',
      parameter: `Retained height ${h == null ? 'unknown' : h.toFixed(2) + ' m'}; heritage ${site.heritage}; flood control lot ${site.floodControlLot}; near natural waterbody ${site.nearWaterbody}; distance to boundary ${w.props.distToBoundary ?? 'unknown'} m`,
      status, result,
      uncertainty: 'The full current text of clause 2.30 (including boundary setback, separation between walls, drainage and waterbody distance) could not be retrieved during research and is NOT encoded. Council LEP/DCP controls may also apply.',
      humanReview: 'Read clause 2.30 of the Codes SEPP on legislation.nsw.gov.au against the final design, or ask the council or a registered certifier.',
    });

    const sur = w.props.surcharge ?? 'unknown';
    let es: Check['status'], er: string;
    if (h == null) { es = 'insufficient'; er = 'Retained height not recorded.'; }
    else if (h > 0.8) { es = 'potential'; er = `Retained height ${h.toFixed(2)} m is above 800 mm, the lower bound of AS 4678. Engineering design by a suitably qualified engineer is required before construction.`; }
    else if (sur === 'unknown') { es = 'insufficient'; er = 'Surcharge condition behind the wall (slope, fence, driveway, structure) not recorded.'; }
    else if (sur !== 'none') { es = 'potential'; er = `Surcharge recorded behind the wall (${sur}). Loads beyond level backfill need engineering review regardless of height.`; }
    else { es = 'verified'; er = `Retained height ${h.toFixed(2)} m is at or below 800 mm with no surcharge recorded. Build to the system manufacturer's installation guide.`; }
    const approved = project.approvals.some(a => a.kind === 'engineering' && a.scope === w.id);
    out.push({
      ...base(`wall-eng:${w.id}`, `Structural review: ${w.name}`, SRC.as4678, 'Australia (NCC) / manufacturer'), objectId: w.id,
      rule: 'AS 4678 covers earth-retaining structures from 800 mm to 15 m high. Manufacturer limits apply below that (for example Adbri Versawall: 800 mm unreinforced; consult council for walls over 800 mm). Surcharge, slopes, poor ground and groundwater require engineering at any height.',
      parameter: `Retained height ${h == null ? 'unknown' : h.toFixed(2) + ' m'}; surcharge ${sur}; soil ${w.props.soil || 'not recorded'}; engineering approval recorded: ${approved ? 'yes' : 'no'}`,
      status: approved && es !== 'insufficient' ? 'verified' : es,
      result: approved ? `${er} An engineering approval record is attached to this wall.` : er,
      uncertainty: 'This software does not calculate sliding, overturning, bearing or global stability, and does not assess soil or groundwater. Post embedment and footing sizes for sleeper walls always come from the manufacturer design table or an engineer. See also ' + SRC.versawall.u,
      humanReview: h != null && h > 0.8 ? 'Structural or geotechnical engineer to design and certify.' : 'Confirm ground conditions on site; engage an engineer if there is any slope, load, fill, water or nearby structure.',
    });
  }

  // 4. Paving
  for (const p of proposed.filter(o => o.type === 'paving')) {
    const cf = p.props.cutFill;
    const flags = [site.heritage];
    out.push({
      ...base(`paving-exempt:${p.id}`, `Planning pathway: ${p.name}`, SRC.paving), objectId: p.id,
      rule: 'Exempt pathways and paving must meet Codes SEPP Subdivision 28: not on certain heritage, foreshore or environmentally sensitive land; cut or fill ancillary to a dwelling in a residential zone no more than 600 mm; surface water must drain to the existing stormwater system.',
      parameter: `Area ${polygonArea(p.points).toFixed(1)} m²; cut/fill ${cf == null || cf === '' ? 'unknown' : cf + ' m'}; heritage ${site.heritage}; fall ${p.props.fallPct ?? 'unknown'}% to ${p.props.fallTo || 'not recorded'}`,
      status: cf != null && cf !== '' && Number(cf) > 0.6 ? 'potential' : flags.includes('yes') ? 'potential' : 'insufficient',
      result: cf != null && cf !== '' && Number(cf) > 0.6 ? 'Cut or fill exceeds 600 mm.' : flags.includes('yes') ? 'Heritage status recorded: exempt development may not apply.' : 'Not all Subdivision 28 standards can be confirmed from the recorded data (zone, landscaped-area ratios, drainage connection).',
      uncertainty: 'Zone-specific area limits and landscaped-area requirements are not encoded. Drainage discharge rights are not assessed.',
      humanReview: 'Check Subdivision 28 of the Codes SEPP, and confirm where paving runoff will drain.',
    });
    out.push({
      ...base(`paving-slip:${p.id}`, `Slip resistance: ${p.name}`, SRC.hb198, 'Australia'), objectId: p.id,
      rule: 'SA HB 198:2014 recommends wet pendulum class P4 for external pavements and ramps up to 1:14, and P5 where steeper than 1:14.',
      parameter: 'Slip rating of selected paver: see Materials Library entry',
      status: 'insufficient',
      result: 'No slip-resistance test classification is recorded for the selected paver.',
      uncertainty: 'HB 198 is guidance, not legislation. Sealers and wear change slip resistance.',
      humanReview: 'Ask the supplier for an AS 4586 wet pendulum test report for the exact product and finish.',
    });
  }

  // 5. Decks
  for (const d of proposed.filter(o => o.type === 'deck')) {
    const area = polygonArea(d.points), ht = d.props.height, db = d.props.distToBoundary;
    const fail: string[] = [];
    if (area > 25) fail.push(`area ${area.toFixed(1)} m² exceeds 25 m²`);
    if (ht != null && ht !== '' && Number(ht) > 1) fail.push(`floor height ${ht} m exceeds 1 m above existing ground`);
    if (db != null && db !== '' && Number(db) < 0.9) fail.push(`${db} m from boundary is less than 900 mm`);
    const unknown = ht == null || ht === '' || db == null || db === '';
    out.push({
      ...base(`deck-exempt:${d.id}`, `Planning pathway: ${d.name}`, SRC.decks), objectId: d.id,
      rule: 'Exempt decks must (among other standards) be no more than 25 m², have a floor no more than 1 m above existing ground, be at least 900 mm from each lot boundary (5 m in some rural zones), be behind the building line, and meet total-area limits.',
      parameter: `Area ${area.toFixed(1)} m²; floor height ${ht ?? 'unknown'} m; distance to boundary ${db ?? 'unknown'} m`,
      status: fail.length ? 'potential' : 'insufficient',
      result: fail.length ? `Does not meet exempt standards: ${fail.join('; ')}.` : unknown ? 'Floor height or boundary distance not recorded.' : 'The encoded standards are met. Total floor area of all such structures, building line and bushfire standards are not checked automatically.',
      uncertainty: 'Only the listed numeric standards are encoded. Structural adequacy must comply with the BCA and manufacturer specifications.',
      humanReview: 'Check Subdivision 6 of the Codes SEPP. Deck framing must follow AS 1684 span tables or an engineer.',
    });
  }

  // 6. Trees
  const works = proposed.filter(o => GEOM[o.type] !== 'point');
  for (const t of project.objects.filter(o => o.type === 'tree' && o.layer === 'existing')) {
    const dbh = t.props.dbh == null || t.props.dbh === '' ? null : Number(t.props.dbh);
    const c = t.points[0];
    let status: Check['status'] = 'insufficient', result = 'Trunk diameter not recorded: notional root zone cannot be calculated.';
    if (dbh != null) {
      const r = 12 * dbh;
      const hit = works.filter(o => distPointToPolyline(c, o.points, GEOM[o.type] === 'area') < r || (GEOM[o.type] === 'area' && Math.hypot(centroid(o.points).x - c.x, centroid(o.points).y - c.y) < r));
      status = hit.length ? 'potential' : 'verified';
      result = hit.length ? `Notional root zone radius ${r.toFixed(1)} m (12 × ${dbh} m). Proposed works inside it: ${hit.map(o => o.name).join(', ')}.` : `Notional root zone radius ${r.toFixed(1)} m. No drawn works inside it.`;
    }
    out.push({
      ...base(`tree:${t.id}`, `Tree protection: ${t.name}`, SRC.as4970, 'Australia / local council'), objectId: t.id,
      rule: 'AS 4970:2025: notional root zone radius = 12 × trunk diameter at standard height. Encroachment needs arborist review. Councils also control pruning and removal.',
      parameter: `Trunk diameter ${dbh == null ? 'unknown' : dbh + ' m'}; retain: ${t.props.retain ? 'yes' : 'no'}`,
      status, result,
      uncertainty: 'Tree position and diameter are as entered. Council tree preservation rules differ between councils and are not encoded.',
      humanReview: `Check ${site.council || 'the local council'} tree controls before pruning, removal or excavation near trees; engage an arborist for encroachments.`,
    });
  }

  // 7. Excavation
  const dig = proposed.some(o => ['wall', 'paving', 'drain', 'garden', 'deck', 'pit', 'cable'].includes(o.type));
  out.push({
    ...base('byda', 'Underground services before excavation', SRC.byda, 'Australia'),
    rule: 'Lodge a Before You Dig Australia enquiry and locate services before any excavation.',
    parameter: `Excavation in scope: ${dig ? 'yes' : 'no'}`,
    status: dig ? 'potential' : 'na',
    result: dig ? 'Proposed work includes excavation. Underground services are not known to this software.' : 'No excavation identified.',
    uncertainty: 'BYDA plans show indicative locations only; private services (stormwater, irrigation, pool lines) are usually not shown.',
    humanReview: 'Lodge a BYDA enquiry; pothole or use a locator before machine excavation.',
  });

  // 8. Electrical
  out.push({
    ...base('electrical', 'Outdoor lighting and electrical work', SRC.categories),
    rule: 'Electrical wiring work is specialist work that needs a licence regardless of the value of the work.',
    parameter: `Lights or cable in scope: ${has('light') || has('cable') ? 'yes' : 'no'}`,
    status: has('light') || has('cable') ? 'potential' : 'na',
    result: has('light') || has('cable') ? 'Lighting is in scope. Cable routes shown are preliminary only.' : 'No lighting in the proposed design.',
    uncertainty: 'Whether a given low-voltage product needs a licensed installer depends on the product and supply connection.',
    humanReview: 'Licensed electrician to confirm supply, protection, cable type and burial, and to do any wiring work.',
  });

  // 9. Drainage
  const dr = has('drain') || has('pit') || has('wall') || has('paving');
  out.push({
    ...base('drainage', 'Stormwater and drainage', SRC.categories),
    rule: 'Plumbing and drainage is specialist work needing a licence regardless of value. Exempt paving must drain to the existing stormwater system; discharge must not be redirected onto neighbouring land.',
    parameter: `Drainage elements or hard surfaces in scope: ${dr ? 'yes' : 'no'}`,
    status: dr ? 'potential' : 'na',
    result: dr ? 'Drainage routes are concept only. The connection point, its capacity and the right to discharge are not verified.' : 'No drainage elements identified.',
    uncertainty: 'No hydraulic calculation is performed (AS/NZS 3500.3). Existing stormwater condition is unknown.',
    humanReview: 'Licensed plumber/drainer to confirm the connection; council or a hydraulic engineer where on-site detention, easements or charged lines are involved.',
  });

  // 10. Council specific
  out.push({
    ...base('council', `Council controls: ${site.council || 'council not selected'}`, { n: 'NSW Planning Portal Spatial Viewer and council LEP/DCP', u: 'https://www.planningportal.nsw.gov.au/spatialviewer/', e: 'Varies by council' }, site.council || 'Local council'),
    rule: 'Local Environmental Plans and Development Control Plans set zone, heritage, tree, landscaped-area, stormwater and foreshore controls that differ between councils.',
    parameter: `Council: ${site.council || 'not selected'}; heritage ${site.heritage}; easements ${site.easements}; bushfire prone ${site.bushfire}`,
    status: 'insufficient',
    result: 'Council-specific controls are not encoded in this software.',
    uncertainty: 'Sydney councils do not have identical requirements. Easements and covenants appear on title, not on maps.',
    humanReview: 'Look up the address in the NSW Planning Portal Spatial Viewer, order a section 10.7 certificate if needed, and check the title for easements.',
  });

  // 11. Boundary
  if (project.objects.some(o => o.type === 'boundary'))
    out.push({
      ...base('boundary', 'Property boundary', { n: 'NSW Land Registry Services: boundaries are defined by registered survey', u: 'https://www.nswlrs.com.au', e: 'General' }),
      rule: 'Only a registered surveyor can define a legal boundary. Fences, aerial imagery and cadastral map lines are not boundaries.',
      parameter: `Boundary geometry confidence: ${project.objects.find(o => o.type === 'boundary')!.confidence}`,
      status: 'potential',
      result: 'The drawn boundary is a reference line only.',
      uncertainty: 'Position may be out by an unknown amount.',
      humanReview: 'Use a survey plan (or engage a registered surveyor) before building on or near a boundary.',
    });
  return out;
}

/** Is construction issue blocked for this project? Returns reasons. */
export function issueBlockers(project: Project, checks: Check[]): string[] {
  const r: string[] = [];
  for (const w of project.objects.filter(o => o.type === 'wall' && o.layer === 'proposed')) {
    const c = checks.find(k => k.id === `wall-eng:${w.id}`);
    const approved = project.approvals.some(a => a.kind === 'engineering' && a.scope === w.id);
    if (c && c.status !== 'verified' && !approved) r.push(`${w.name}: ${c.result}`);
    if (w.props.system === 'concrete-sleeper' && (w.props.footingDia == null || w.props.footingDepth == null) && !approved) r.push(`${w.name}: post footing dimensions not provided by an engineer or manufacturer table.`);
  }
  if (!project.approvals.some(a => a.kind === 'measurements')) r.push('Site measurements have not been signed off as verified.');
  const unverified = project.objects.filter(o => o.layer === 'proposed' && o.confidence !== 'verified' && ['wall', 'paving', 'deck'].includes(o.type));
  if (unverified.length) r.push(`Set-out geometry not verified for: ${unverified.map(o => o.name).join(', ')}.`);
  return r;
}

export const lengthOf = (o: SiteObject) => polylineLength(o.points, GEOM[o.type] === 'area');
