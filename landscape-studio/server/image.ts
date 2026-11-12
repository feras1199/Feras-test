// Illustrative "after" image generation from a site photo. Provider adapter; key stays on the server.
// Implemented provider: OpenAI image edits (IMAGE_PROVIDER=openai). NOT verified live in this build:
// no key was available. The result is stored as a normal media file and labelled illustrative.

const PROVIDER = process.env.IMAGE_PROVIDER ?? 'openai';
const KEY = PROVIDER === 'openai' ? process.env.OPENAI_API_KEY : undefined;
const MODEL = process.env.LIS_IMAGE_MODEL ?? 'gpt-image-1';
export const imageStatus = () => ({ configured: !!KEY, provider: KEY ? PROVIDER : undefined, model: KEY ? MODEL : undefined });

export class ImageError extends Error { status: number; code: string; constructor(m: string, status = 503, code = 'IMAGE_NOT_CONFIGURED') { super(m); this.status = status; this.code = code; } }

export function buildPrompt(input: { title: string; style: string; changes: string[]; materials: string[] }) {
  return [
    `Photorealistic illustrative "after" visualisation of this same residential backyard in Sydney, Australia, in a ${input.style} style (${input.title}).`,
    'Keep the existing house, fences, boundary, major trees and the camera viewpoint exactly where they are in the photo.',
    `Show these proposed works: ${input.changes.slice(0, 12).join('; ')}.`,
    `Materials: ${input.materials.slice(0, 8).join('; ')}.`,
    'Natural daylight, realistic scale, no text, no people, no watermarks.',
  ].join(' ');
}

export async function generateRender(photo: Buffer, mime: string, prompt: string): Promise<{ png: Buffer; provider: string; model: string }> {
  if (!KEY) throw new ImageError('AI image generation is not configured on the server.');
  if (PROVIDER !== 'openai') throw new ImageError(`Image provider "${PROVIDER}" is not implemented.`, 501, 'IMAGE_PROVIDER');
  const fd = new FormData();
  fd.append('model', MODEL);
  fd.append('prompt', prompt);
  fd.append('size', 'auto');
  fd.append('image', new Blob([new Uint8Array(photo)], { type: mime }), mime === 'image/png' ? 'site.png' : 'site.jpg');
  const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd, signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new ImageError(`Image provider returned ${r.status}: ${(await r.text()).slice(0, 300)}`, 502, 'IMAGE_PROVIDER');
  const j: any = await r.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new ImageError('Image provider returned no image', 502, 'IMAGE_PROVIDER');
  return { png: Buffer.from(b64, 'base64'), provider: PROVIDER, model: MODEL };
}
