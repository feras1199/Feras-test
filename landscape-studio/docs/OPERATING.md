# Cost and operating requirements

No prices in this file were verified against provider pricing pages during the build. Treat every dollar figure as an estimate to check before committing. Provider pages to check: anthropic.com/pricing, airtable.com/pricing, and your chosen host's pricing page.

## What it needs to run

| Component | Requirement | Cost |
|---|---|---|
| App server | Any machine or small VM that runs Node 22.18+ (1 vCPU, 1 GB RAM is ample for one company). Can also run on an office PC | Estimate: a small VPS is typically tens of AUD per month; an existing office PC costs nothing extra |
| Database | SQLite file inside the data folder. No separate database service | $0 |
| File storage | Photos are resized to ≤2400 px JPEG (typically a few hundred KB). 30 photos per job ≈ 10 MB; 200 jobs/year ≈ 2 GB | Disk on the server; back up the data folder to any cloud drive |
| TLS / domain | Needed if accessed from site over the internet (reverse proxy such as Caddy or a host that provides HTTPS) | Domain registration is an annual fee; certificates can be free (Let's Encrypt) |
| Backups | Copy `data/` nightly | Storage cost only |

## Optional services

| Service | Used for | Cost basis |
|---|---|---|
| Anthropic API | Photo analysis, free-form design instructions | Pay per token. A photo analysis sends one resized image plus a short prompt; an assistant request sends the design JSON. Expect cents per request; confirm on the pricing page. Usage scales with how often staff press the buttons, not with project count |
| Airtable | CRM sync | Existing Airtable plan; API access depends on plan limits (rate limits per base apply) |
| Mapping / aerial imagery | Not integrated. Users upload screenshots they are licensed to use | $0 now. A mapping API (e.g. NSW spatial services, commercial providers) would add per-request costs and licence terms |
| Phone scanning | Third-party apps export files the app stores | App subscriptions if used |
| Image rendering | Not integrated | Would be per-image API cost |

## Scaling limits

- Single Node process with SQLite: fine for tens of concurrent users. Concurrent edits to the *same* project are last-write-wins (history keeps the previous 30 saves).
- PDF generation happens in the browser; very large drawings (hundreds of objects) slow older phones but not the server.
- Media served from local disk; for multiple servers move media to object storage (S3-compatible) behind the same API.
