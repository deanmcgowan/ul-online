# Configuration

This page walks through every environment variable and external service the app needs. For a general setup overview, the **[README](../README.md#getting-started)** is the starting point.

---

## Prerequisites

You'll need:

- **Node.js** (check `.nvmrc` or `package.json` `engines` field for the recommended version)
- **npm** (comes with Node.js)
- A **Supabase project** (free tier works fine for development)
- **Trafiklab API keys** for the Sverige 3 dataset and ResRobot — register at [trafiklab.se](https://www.trafiklab.se/)
- Optionally, a **Trafikverket Open Data API key** for road situation alerts

---

## Frontend environment variables

Create a local `.env` file (the repo ships an `.env.example` to copy from):

```bash
cp .env.example .env
```

Then fill in:

```bash
VITE_SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Both values are **public by design**. In a Vite app, anything prefixed `VITE_` is bundled into the JavaScript and visible in the browser. Supabase explicitly expects these two values to be public. Do not put private keys here.

> The `.gitignore` already excludes `.env` files, so there is no risk of accidentally committing your local values.

---

## Supabase Edge Function secrets

Server-side secrets go into your Supabase project's Edge Function secrets, not into the frontend `.env`. You can set them via the Supabase dashboard (**Project → Edge Functions → Secrets**) or the Supabase CLI:

```bash
supabase secrets set TRAFIKLAB_SWEDEN3_RT_KEY=your_key
supabase secrets set TRAFIKLAB_SWEDEN3_STATIC_KEY=your_key
supabase secrets set TRAFIKVERKET_OPEN_DATA_API_KEY=your_key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

| Secret | Where to get it |
|--------|----------------|
| `TRAFIKLAB_SWEDEN3_RT_KEY` | Trafiklab project — Sverige 3 GTFS Realtime |
| `TRAFIKLAB_SWEDEN3_STATIC_KEY` | Trafiklab project — Sverige 3 GTFS Static |
| `TRAFIKVERKET_OPEN_DATA_API_KEY` | [Trafikverket Open Data](https://www.trafikverket.se/tjanster/apis-och-oppna-data/) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard — Project Settings → API → service_role key |

The `SUPABASE_SERVICE_ROLE_KEY` is needed by Edge Functions that write to the database. Never put it in a `VITE_` variable.

---

## Supabase project setup

1. Create a new project at [supabase.com](https://supabase.com/).
2. Apply the SQL migrations (see [Development Guide — Supabase](Development-Guide#supabase-local-development)).
3. Deploy the Edge Functions.
4. Set the secrets listed above.
5. Run the static GTFS import once to populate the database.

The full recommended flow is described in the **[README — Supabase setup](../README.md#supabase-setup)** section.

---

## Docker build arguments

When building the Docker image, the Vite frontend environment variables must be passed as build arguments because Vite bakes them into the bundle at build time, not at run time:

```bash
docker build \
  --build-arg VITE_SUPABASE_URL=https://... \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=eyJ... \
  -t ul-online:local .
```

See [Development Guide — Docker](Development-Guide#docker) for the full build and run commands.

---

## Summary

| Variable | Where | Public? |
|----------|-------|---------|
| `VITE_SUPABASE_URL` | `.env` / Docker build arg | ✅ Yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env` / Docker build arg | ✅ Yes |
| `TRAFIKLAB_SWEDEN3_RT_KEY` | Supabase Edge Function secret | ❌ No |
| `TRAFIKLAB_SWEDEN3_STATIC_KEY` | Supabase Edge Function secret | ❌ No |
| `TRAFIKVERKET_OPEN_DATA_API_KEY` | Supabase Edge Function secret | ❌ No |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function secret | ❌ No |
