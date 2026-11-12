// Provider-agnostic AI layer. Only Anthropic is implemented; keys stay on the server.
// The model never computes quantities or prices: it identifies features and proposes structured operations,
// which the client validates and the user approves.

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.LIS_AI_MODEL ?? 'claude-sonnet-5-5';
export const aiStatus = () => ({ configured: !!KEY, model: KEY ? MODEL : undefined });

class AiError extends Error { status: number; code: string; constructor(m: string, status = 503, code = 'AI_NOT_CONFIGURED') { super(m); this.status = status; this.code = code; } }

async function call(content: unknown[], system: string, maxTokens = 1500): Promise<string> {
  if (!KEY) throw new AiError('No ANTHROPIC_API_KEY is configured on the server.');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }), signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new AiError(`AI provider returned ${r.status}: ${(await r.text()).slice(0, 300)}`, 502, 'AI_PROVIDER');
  const j: any = await r.json();
  return (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
}
const json = (t: string) => { const m = t.match(/\{[\s\S]*\}/); if (!m) throw new AiError('AI response was not JSON', 502, 'AI_FORMAT'); return JSON.parse(m[0]); };

export async function analyzePhoto(buf: Buffer, mime: string) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new AiError('Only JPEG, PNG, WebP or GIF photos can be analysed', 400, 'AI_FORMAT');
  const text = await call([
    { type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } },
    { type: 'text', text: 'Identify landscaping-relevant features in this residential site photo. Return JSON only: {"summary": string, "features": [{"label": string, "type": one of "Building","Retaining wall","Fence","Paving","Garden bed","Tree","Steps","Drain / pit","Level change","Service fixture","Obstruction","Needs measuring", "x": 0..1 fraction of width, "y": 0..1 fraction of height, "note": string}], "measurements": [short instructions for the most useful tape/laser measurements to take]}. Do not estimate dimensions in metres. Do not identify boundaries as legal boundaries.' },
  ], 'You assist a Sydney landscaping contractor. Be conservative. Never claim measurements from a single photo.');
  const j = json(text);
  const features = (Array.isArray(j.features) ? j.features : []).filter((f: any) => typeof f?.label === 'string' && f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1).slice(0, 30);
  return { live: true, model: MODEL, summary: String(j.summary ?? ''), features, measurements: (Array.isArray(j.measurements) ? j.measurements : []).map(String).slice(0, 10) };
}

export async function assist(text: string, context: unknown) {
  const out = await call([{ type: 'text', text: `Project context (JSON):\n${JSON.stringify(context).slice(0, 60000)}\n\nInstruction: ${text}` }],
    'You edit a landscape design by proposing operations. Return JSON only: {"answer": short plain-English explanation including trade-offs, "ops": [...]}. Allowed ops: {"op":"setMaterial","objectId","materialId"}, {"op":"setWallSystem","objectId","system":"concrete-sleeper"|"segmental-block"|"sandstone-block"|"timber-sleeper"}, {"op":"setLength","objectId","length":metres}, {"op":"setRect","objectId","w","h"}, {"op":"setProp","objectId","prop","value"} (non-structural props only), {"op":"setEstimate","field":"markupPct"|"contingencyPct"|"overheadPct","value"}. Use only ids present in the context. Never reduce drainage, footings or structural items to save money. Do not state prices or quantities as facts; the app calculates them.', 2000);
  const j = json(out);
  return { answer: String(j.answer ?? ''), ops: Array.isArray(j.ops) ? j.ops : [], model: MODEL };
}
