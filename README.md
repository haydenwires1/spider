# Website Audit Crawler

A local web app that crawls a site from one starting URL, captures desktop and mobile screenshots with Playwright, extracts structured page data, asks an AI model for recommendations, and generates a PDF audit report.

## Quick Start

```bash
npm install
npm run playwright:install
cp .env.example .env
npm run dev
```

Open the web UI at `http://localhost:5173`. The API runs at `http://localhost:3001`.

If `OPENAI_API_KEY` is not set, the worker still crawls pages and generates a PDF using deterministic fallback analysis marked as local fallback output.

## Scripts

- `npm run dev` starts the API and web app.
- `npm run build` builds all workspaces.
- `npm start` starts the production API, which also serves the built web app from `apps/web/dist`.
- `npm test` runs unit and integration tests.
- `RUN_INTEGRATION=1 npm test` includes the local fixture crawl/PDF integration test.
- `npm run typecheck` runs TypeScript project checks.
- `npm run playwright:install` installs Chromium for screenshots and PDF generation.

## Render Deployment

This app is designed to run as one always-on Docker web service with a persistent disk. The API process runs long Playwright crawl jobs, stores audit state in SQLite, and writes generated artifacts to local disk.

The included `render.yaml` config creates:

- one Docker web service
- a persistent disk mounted at `/var/data`
- a health check at `/api/health`

Set these environment variables in Render:

```bash
AUDIT_DATA_DIR=/var/data
DATABASE_URL=file:/var/data/audits.sqlite
APP_USERNAME=your-username
APP_PASSWORD=your-password
OPENAI_API_KEY=your-openai-key
OPENAI_AUDIT_MODEL=gpt-5.4-mini
RESPECT_ROBOTS_TXT=true
```

`APP_USERNAME` and `APP_PASSWORD` enable Basic Auth for the UI, API, reports, screenshots, and generated files. `/api/health` remains public for Render health checks.

On startup, any audit left in `queued` or `running` state is marked failed because in-progress Playwright jobs cannot safely resume after a restart. Completed audits and generated reports remain available as long as the Render disk is attached.

## MVP Limits

- Same-domain unauthenticated crawling only.
- Local SQLite database and filesystem storage.
- PDF report output, not Google Docs.
- Lightweight accessibility review only; findings are phrased as potential issues unless validated by a scanner.
