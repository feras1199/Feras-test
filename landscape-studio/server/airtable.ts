// Optional one-way sync of business records (customer + project summary) to an existing Airtable base.
// Geometry stays in this app's database. Record ids are stored to prevent duplicates; existing
// Airtable fields not listed here are never touched.
const TOKEN = process.env.AIRTABLE_TOKEN, BASE = process.env.AIRTABLE_BASE_ID;
const T_CUST = process.env.AIRTABLE_CUSTOMERS_TABLE ?? 'Customers', T_PROJ = process.env.AIRTABLE_PROJECTS_TABLE ?? 'Projects';
export const airtableStatus = () => ({ configured: !!(TOKEN && BASE) });

async function at(method: string, table: string, body?: unknown, id?: string) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(table)}${id ? '/' + id : ''}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<{ id: string }>;
}

export async function syncProject(p: any, kv: (k: string, v?: unknown) => any) {
  if (!TOKEN || !BASE) return { ok: false, message: 'Airtable is not configured (AIRTABLE_TOKEN, AIRTABLE_BASE_ID).' };
  const map = kv('airtable-map') ?? {};
  const cust = { fields: { Name: p.customer.name, Phone: p.customer.phone, Email: p.customer.email, 'LIS Customer ID': p.customer.id } };
  const c = map[p.customer.id] ? await at('PATCH', T_CUST, cust, map[p.customer.id]) : await at('POST', T_CUST, cust);
  map[p.customer.id] = c.id;
  const proj = { fields: { Name: p.name, 'Site Address': [p.site.address, p.site.suburb].filter(Boolean).join(', '), Council: p.site.council, Status: p.status, 'LIS Project ID': p.id, Customer: [c.id] } };
  const r = map[p.id] ? await at('PATCH', T_PROJ, proj, map[p.id]) : await at('POST', T_PROJ, proj);
  map[p.id] = r.id; kv('airtable-map', map);
  return { ok: true, message: `Synced to Airtable (customer ${c.id}, project ${r.id}).` };
}
