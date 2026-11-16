/** Browser helpers shared by site visit media and Ask ATLAS. */
const PHOTO_EDGE = 1600;

/** Shrinks a phone photo to a sensible size (and turns HEIC into JPEG) before it is uploaded. */
export async function shrinkPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, PHOTO_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    if (!blob) throw new Error();
    return blob;
  } catch {
    throw new Error(`Couldn't read ${file.name}. Try taking the photo again.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function recorderType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Reads how long an audio file is, from its own metadata. Undefined if the browser can't tell. */
export function audioDuration(file: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (v?: number) => { URL.revokeObjectURL(url); resolve(v && Number.isFinite(v) && v > 0 ? v : undefined); };
    const timer = window.setTimeout(() => done(), 5000);
    a.preload = "metadata";
    a.onloadedmetadata = () => { clearTimeout(timer); done(a.duration); };
    a.onerror = () => { clearTimeout(timer); done(); };
    a.src = url;
  });
}

/** Friendly size limit check before a long upload starts. */
export const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
