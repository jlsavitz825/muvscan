# MüvScan

Production AI vision scanner for MÜV moving inventory capture.

## What changed

- Rebuilt as a deployable Next.js app.
- Camera-first scanner UI with manual scan and auto-scan.
- Motion gating so auto-scan waits for a stable frame.
- Review-before-add flow so AI guesses do not automatically enter inventory.
- Server-side vision route; the browser never receives the AI key.
- Local inventory persistence.
- Cubic-foot, weight, fragile-count, and truck-size estimate.
- JSON export for downstream MÜV estimate flow.

## Environment

Set this in the deployment provider:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Optional:

```bash
CLAUDE_MODEL=claude-sonnet-4-20250514
SCAN_RATE_LIMIT=40
```

## Deploy

This repo is ready for Vercel as a Next.js project. Import `jlsavitz825/muvscan`, add the environment variable above, and deploy.

## Routes

- `/` scanner UI
- `/api/scan` server-side vision scan endpoint
- `/api/health` health check
