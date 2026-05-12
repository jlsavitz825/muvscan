# MüvScan — AI Vision Scanner

The production scanner for the MÜV moving app. Point a phone camera at a room, AI vision identifies every moveable item, the user taps to confirm, and a full move inventory is built in real time.

**Stack:** Next.js 14 (App Router) · React 18 · TypeScript · Anthropic Claude Sonnet 4 Vision
**Hosting:** Vercel (serverless functions on Node runtime)
**Tagline:** Move Smart. Breathe Easy.

---

## What this is

A standalone Next.js app you can deploy independently, embed in your main MÜV site, or eventually wrap as a native shell. The architecture is a thin React client + a single server-side API route that proxies frames to Claude. The API key never reaches the browser.

```
Phone camera ─► canvas frame ─► /api/scan ─► Claude Vision ─► bounding boxes ─► inventory
                                  (server)
```

---

## 1. One-time setup

```bash
# clone or unzip into a folder, then:
cd muvscan-production
npm install
cp .env.local.example .env.local
# open .env.local and paste your Anthropic API key
```

Get an Anthropic API key at https://console.anthropic.com. Use a dedicated key for this project so you can revoke it without affecting other work.

## 2. Run locally

```bash
npm run dev
# open http://localhost:3000
```

**Important:** Mobile browsers (and most desktop browsers) require HTTPS for camera access. `localhost` is treated as secure for development, so dev mode works. For testing on a real phone over your local network, use a tool like `ngrok http 3000` or just deploy to Vercel and test there — it's faster.

## 3. Deploy to Vercel

The repo is pre-configured for Vercel. Three ways to deploy:

### Option A — One-click via GitHub
1. Push this folder to a new GitHub repo
2. Go to https://vercel.com/new, import the repo
3. In project settings, add the environment variable `ANTHROPIC_API_KEY`
4. Deploy

### Option B — Vercel CLI
```bash
npm i -g vercel
vercel
# follow the prompts
vercel env add ANTHROPIC_API_KEY production
# paste your key
vercel --prod
```

### Option C — Vercel dashboard, drag-and-drop
1. Zip this folder
2. Drag onto https://vercel.com/new
3. Add `ANTHROPIC_API_KEY` env var
4. Deploy

Once deployed, Vercel gives you a permanent URL (e.g. `muvscan.vercel.app`) with HTTPS, which is required for camera access. Buy a custom domain in Vercel settings if you want `scan.muv.app` or similar.

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | — | Your Anthropic API key. Server-only. |
| `CLAUDE_MODEL` | — | `claude-sonnet-4-20250514` | Override the model. |
| `SCAN_RATE_LIMIT` | — | `60` | Max scans per IP per minute. |

---

## Project structure

```
muvscan-production/
├── app/
│   ├── api/scan/route.ts    ← Server-side Anthropic proxy
│   ├── layout.tsx           ← Root layout, metadata, font
│   ├── page.tsx             ← Scanner UI (the main React component)
│   ├── manifest.ts          ← PWA manifest
│   └── globals.css          ← All styles
├── lib/
│   ├── types.ts             ← Shared TypeScript types
│   ├── volumes.ts           ← Volume DB + emoji/category helpers
│   └── prompt.ts            ← The Claude vision prompt
├── public/                  ← MÜV brand assets, favicons, PWA icons
├── .env.local.example
├── next.config.mjs
├── package.json
├── tsconfig.json
└── vercel.json
```

---

## How it works

1. **Camera setup** — `getUserMedia({ facingMode: 'environment' })` requests the rear camera. On desktop, falls back to whatever camera is available.

2. **Scan loop** — Every 5 seconds, when no detections are pending user review, the client:
   - Captures the visible portion of the video to a canvas (accounting for `object-fit: cover` crop)
   - Compresses to JPEG @ 0.78 quality, max 1024px wide
   - POSTs to `/api/scan` as base64

3. **Server-side analysis** — `app/api/scan/route.ts`:
   - Rate-limits by IP (60/min default)
   - Validates the request body
   - Sends the image + structured prompt to Claude Vision via the Anthropic SDK
   - Validates Claude's JSON output (clamps bbox coords, drops malformed items)
   - Returns up to 8 detections

4. **Bounding boxes** — Each detection becomes a glowing pulsing div positioned absolutely over the video. Tap → solid glow + add prompt slides up.

5. **Inventory** — Items added go into React state, persisted to `localStorage`. Quantities merge if the same item is added twice in the same room. Export as JSON for the next stage of your flow (mover matching, quote, etc.).

---

## Cost estimate

Each scan is one Claude Sonnet 4 vision call:
- Image input (~1024×768): ~1,500 tokens
- Prompt: ~300 tokens
- Output: ~300 tokens

**Approximate cost: $0.011 per scan** at current Sonnet 4 pricing ($3/MTok in, $15/MTok out).

A user scanning a 5-room home (~30 scans total) costs about **$0.33 per move**.

If costs become a concern at scale:
- Switch to Claude Haiku 4.5 for the first-pass detection (~10× cheaper, slightly less accurate)
- Add a motion-detection step on the client to skip scans when the camera is still
- Cache by frame hash so the same view doesn't get re-analyzed

---

## Integrating into the main MÜV app

Three options, in order of speed:

**1. iframe embed.** Drop `<iframe src="https://scan.muv.app" allow="camera" />` into the main app where the scanner button currently lives. Listen for a `postMessage` from the scanner when the user is done. Fastest path, zero changes to either codebase.

**2. Reverse-proxy route.** In your main Next.js app's `next.config.js`, add a rewrite: `{ source: '/scan/:path*', destination: 'https://scan.muv.app/:path*' }`. The scanner appears at `muv.app/scan` while running on its own deployment. Clean URLs, separate deploys.

**3. Merge the code.** Copy `app/api/scan/route.ts`, `app/page.tsx` (as a sub-route), `lib/*`, and the CSS into your main app. One deployment, shared design system.

The exported JSON inventory structure is stable — you can build the integration before deciding which option to use.

---

## Known constraints & next steps

- **iOS Safari quirk:** the first camera permission prompt is browser-level, the second is system-level. The placeholder will say "Camera unavailable" until both are granted. Reloading after granting clears this.
- **No offline mode.** Scanning requires network for the API call. Inventory is persisted locally, so users keep their work if they go offline mid-scan.
- **No motion detection.** Even pointing at the same wall triggers a scan every 5 seconds. Easy to add — diff two frames' pixel data and skip if change is below threshold.
- **No user accounts.** Inventory is local to the device. To sync across devices or pass to a mover, the export-JSON button is the bridge today.

When the scanner has real user volume, the highest-ROI improvements (in order):
1. Motion detection → cut API costs ~40%
2. Confidence threshold tuning per category → cleaner detections
3. A second-pass "verify all" step at end of scan, sending one consolidated frame to make sure nothing was missed
4. Lighten the prompt → faster responses (currently ~2s end-to-end)

---

## Built by

MÜV — the AI-powered moving app.
Move Smart. Breathe Easy.
