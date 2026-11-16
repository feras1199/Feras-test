import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore.ts';

const cache = new Map<string, string>();

export function useMediaUrl(projectId: string | undefined, id: string | undefined): { url: string | null; missing: boolean } {
  const storage = useStore(s => s.storage);
  const key = `${projectId}/${id}`;
  const [state, setState] = useState<{ url: string | null; missing: boolean }>({ url: cache.get(key) ?? null, missing: false });
  useEffect(() => {
    let live = true;
    if (!projectId || !id || !storage) return;
    if (cache.has(key)) { setState({ url: cache.get(key)!, missing: false }); return; }
    setState({ url: null, missing: false });
    storage.getMedia(projectId, id).then(b => {
      if (!live) return;
      if (!b) { setState({ url: null, missing: true }); return; }
      const u = URL.createObjectURL(b); cache.set(key, u); setState({ url: u, missing: false });
    }).catch(() => live && setState({ url: null, missing: true }));
    return () => { live = false; };
  }, [key, storage]); // eslint-disable-line
  return state;
}

export const forgetMedia = (projectId: string, id: string) => { const k = `${projectId}/${id}`; const u = cache.get(k); if (u) URL.revokeObjectURL(u); cache.delete(k); };

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
const DOC_EXT = ['pdf', 'glb', 'gltf', 'obj', 'usdz', 'ply', 'las', 'laz', 'e57', 'dxf', 'csv', 'txt'];
export const MAX_BYTES = 40 * 1024 * 1024;

export interface Prepared { blob: Blob; mime: string; isImage: boolean; w?: number; h?: number }

/**
 * Validate and normalise an upload. Images are re-encoded through a canvas (max 2400 px),
 * which also removes EXIF metadata including GPS location.
 */
export async function prepareUpload(file: File): Promise<Prepared> {
  if (file.size === 0) throw new Error(`${file.name}: the file is empty.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_TYPES.includes(file.type) || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    let bmp: ImageBitmap;
    try { bmp = await createImageBitmap(file); } catch { throw new Error(`${file.name}: this image could not be read. It may be corrupt or in a format the browser cannot decode.`); }
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.86));
    if (!blob) throw new Error(`${file.name}: could not process the image.`);
    return { blob, mime: 'image/jpeg', isImage: true, w: c.width, h: c.height };
  }
  if (file.type === 'image/heic' || file.type === 'image/heif' || ext === 'heic' || ext === 'heif') throw new Error(`${file.name}: HEIC photos are not supported by this browser. On iPhone set Camera → Formats → Most Compatible, or export as JPEG.`);
  if (file.type.startsWith('video/')) throw new Error(`${file.name}: video upload is not supported yet. Take still photos, or extract frames first.`);
  if (DOC_EXT.includes(ext)) return { blob: file, mime: file.type || 'application/octet-stream', isImage: false };
  throw new Error(`${file.name}: unsupported file type. Use JPEG, PNG or WebP photos, PDF plans, or scan files (GLB, GLTF, OBJ, USDZ, PLY, LAS, E57).`);
}
