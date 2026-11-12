# Turning on live AI image generation

Never paste an API key into a chat, a file in the repository, or the browser. The key lives only in the server's environment.

## Steps

1. **Create a key** with an image provider. The implemented adapter is OpenAI image edits. Create an API key in the OpenAI dashboard, add a payment method, and set a monthly spending limit there.
2. **Give the key to the server.** On the machine that runs `npm run server`, set environment variables before starting it:
   - `IMAGE_PROVIDER=openai`
   - `OPENAI_API_KEY=<your key>`
   - optional `LIS_IMAGE_MODEL` (default `gpt-image-1`; check the provider's current model list)

   Use your host's secret settings (for example a systemd `EnvironmentFile` with permissions 600, or the hosting platform's secrets page). Do not commit a `.env` file; `.env` is already in `.gitignore`.
3. **Restart the server**, then open `http://<server>/api/health`. It should show `"image":{"configured":true,"provider":"openai","model":"..."}`.
4. **Test once** on the demo site: Visual Concepts → Generate three concepts → "Generate AI render" on one card. Check that:
   - the picture appears with the "AI-generated illustration" label;
   - `GET /api/renders/prj_demo_site` shows a row with status `ok`, the model, the prompt and the source photo id.
5. **Review the prompt** in `server/image.ts` (`buildPrompt`) and adjust the wording if renders move the house or fences.

## Things that are not verified

- No live image call was made during development (no key was available). The request shape follows the provider's documented image-edit endpoint; confirm it against current provider documentation on first use.
- Image models can move or invent objects. That is why renders are labelled illustrative and never feed geometry.
- Costs are charged per image by the provider. Check its pricing page; this repository makes no price claim.

## Adding another provider

Implement another branch in `generateRender()` in `server/image.ts` that returns `{ png, provider, model }`, and set `IMAGE_PROVIDER` to its name. Nothing else changes: the client, the provenance log and the labels are provider-neutral.
