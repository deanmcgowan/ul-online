# UL Online

A live transit map for UL data, focused on showing real-time vehicle positions, stops, and how far you can walk or run to catch a bus.

## Features

- Live vehicle positions shown on an interactive map
- Stop markers with the ability to filter buses by stop
- User location with configurable walking and running reach circles
- Vehicle popups showing speed, heading, and estimated distance/time from your location
- Adjustable walking speed, running speed, and buffer time
- Automatic refresh of live vehicle data while the app is visible

## Tech stack

- **Frontend:** Vite, React, TypeScript
- **UI:** Tailwind CSS, shadcn/ui, Lucide icons
- **Mapping:** OpenLayers
- **Backend:** Supabase (database + Edge Functions)
- **Transit data:** GTFS static + GTFS Realtime

## How it works

The app combines two kinds of transit data:

1. **Static GTFS data** for stops, routes, trips, and stop-to-route mappings
2. **Realtime GTFS-RT data** for current vehicle positions

The frontend:
- loads stop and route data from Supabase
- requests live vehicle positions from a Supabase Edge Function
- renders everything on an OpenLayers map
- lets the user filter buses by stop and view distance/time estimates from their location

## Project structure

```text
.
├── public/
├── src/
│   ├── components/
│   ├── hooks/
│   ├── integrations/
│   │   └── supabase/
│   ├── lib/
│   ├── pages/
│   └── test/
├── supabase/
│   ├── functions/
│   │   ├── trafiklab-import/
│   │   └── trafiklab-vehicles/
│   ├── migrations/
│   └── config.toml
├── package.json
└── README.md
```

## Routes

- `/` — main map view
- `/settings` — user preferences for walking speed, running speed, and buffer time

## Getting started

### Prerequisites

Before running the project, you will need:

- Node.js
- npm
- A Supabase project
- API access for GTFS static and GTFS Realtime data

### Frontend environment variables

Create a local environment file and add:

```bash
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
```

### Supabase Edge Function secrets

Your Edge Functions will also need server-side secrets configured for:

```bash
TRAFIKLAB_GTFS_RT_KEY=your_realtime_api_key
TRAFIKLAB_GTFS_REGIONAL_STATIC_KEY=your_static_api_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Install and run

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

## VS Code test and debug setup

This repository now includes ready-to-use VS Code workspace files in `.vscode/`.

Recommended extensions:

- Playwright Test
- Vitest Explorer
- Docker
- ESLint

### Local app debugging

Use the Run and Debug panel and start one of these profiles:

- `Frontend: Chrome`
- `Frontend: Edge`

Both profiles start the Vite dev server automatically and attach the browser debugger to `http://localhost:8080`.

### Unit tests

You can run tests from either the Testing panel or the terminal tasks:

```bash
npm run test
npm run test:watch
```

The `Vitest: current file` launch profile is set up for stepping through the currently open test file.

### Playwright

Playwright is configured to run against a local Vite server on port `4173`.

Run it with:

```bash
npx playwright test
```

The `Playwright: current file` launch profile runs the currently open spec in headed Chromium for debugging.

Add future end-to-end specs under `e2e/`.

### VS Code tasks

The workspace also provides tasks for:

- installing dependencies
- starting the dev server
- building the app
- previewing the production build
- running Vitest
- running Playwright
- building and running the Docker image

Open the Command Palette and run `Tasks: Run Task` to access them.

## Docker

The repository now includes:

- `Dockerfile` for a multi-stage frontend build
- `compose.yml` for local container runs
- `docker/nginx.conf` for SPA routing and cache headers

### Build the image

Vite needs the frontend environment variables at build time, so pass them as build args:

```bash
docker build \
	--build-arg VITE_SUPABASE_URL=your_supabase_url \
	--build-arg VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key \
	-t ul-online:local .
```

### Run the container

```bash
docker run --rm -p 8080:80 ul-online:local
```

### Run with Compose

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in your shell or compose environment file, then run:

```bash
docker compose up --build
```

The container serves the built frontend through nginx on port `8080`.

## Available scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run test
```

## Supabase setup

This repository includes Supabase migrations and Edge Functions.

Recommended setup flow:

1. Create and connect a Supabase project
2. Apply the SQL migrations in `supabase/migrations/`
3. Deploy the Edge Functions in `supabase/functions/`
4. Configure the required frontend environment variables and function secrets
5. Run the static import flow once so stop and route data is available
6. Start the frontend and verify live vehicles are loading correctly

## Data model overview

The project currently works with transit-related tables such as:

- `transit_stops`
- `transit_routes`
- `transit_trips`
- `stop_routes`

There is also groundwork for richer stop-time / next-stop functionality in the schema.

## Current limitations

- The current UX is centered on **live map tracking and stop-based filtering**
- Static import currently focuses on the core data needed for the map experience
- Some backend groundwork exists for richer arrival/next-stop features, but that is not yet the main user-facing workflow

## Roadmap ideas

- Show upcoming stops for a selected vehicle
- Add route search and line filtering
- Save favorite stops
- Add service alerts
- Improve mobile UX
- Add CI/CD and deployment documentation
- Add screenshots or a short demo GIF to the README

## Contributing

Contributions are welcome.

If you open a PR, please include:

- a short summary of the change
- screenshots for UI updates
- setup notes if configuration changed

## Notes

This project currently has no polished public-facing documentation outside this README, so if you are contributing, please prefer small, well-described changes and keep setup steps explicit.
