// Text prompt for an illustrative "after" image. Shared by the server image adapter and the
// "Copy prompt" button (for pasting into ChatGPT or another image tool together with the photo).

export function buildPrompt(input: { title: string; style: string; changes: string[]; materials: string[] }) {
  return [
    `Photorealistic illustrative "after" visualisation of this same residential backyard in Sydney, Australia. Design: ${input.title}${input.style && !input.title.toLowerCase().includes(input.style.toLowerCase()) ? `, ${input.style} style` : ''}.`,
    'Keep the existing house, fences, boundary, major trees and the camera viewpoint exactly where they are in the photo.',
    `Show these proposed works: ${input.changes.slice(0, 12).join('; ')}.`,
    `Materials: ${input.materials.slice(0, 8).join('; ')}.`,
    'Natural daylight, realistic scale, no text, no people, no watermarks.',
  ].join(' ');
}

export const CHAT_PROMPT_INTRO = 'Attach the BEFORE photo of the yard to this message, then send:';
