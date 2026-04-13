# UL Online

A live transit web app for UL (Uppsala Lokaltrafik) bus data. It shows real-time vehicle positions on an interactive map, lets you filter by stop, plan commutes between saved places, and receive push notifications when it's time to leave.

## What it does

- Live bus positions refreshed every 10 seconds
- Interactive OpenLayers map centred on Uppsala
- Stop markers that appear once you zoom in; click one to see which buses serve it and when they arrive
- Commute planner — set a home and a destination, and the dashboard shows the next departures together with whether you need to leave now, soon, or can wait
- Road situation alerts from Trafikverket shown on the map and in the dashboard
- GTFS-RT service alerts (cancellations, disruptions) shown per route
- Push notifications to remind you when to leave for a saved trip
- Saved places (home, work, school, or custom) managed in the settings screen
- Multilingual UI — British English or Swedish, or follow the browser/OS setting
- PWA install prompt on iOS so the app can be added to the home screen

## Architecture overview

The project is a single repository containing both the React frontend and a Node.js backend. They are shipped together as one Docker image and run as one process in production.

```
Browser (React / Vite)
        │
        │  HTTP (same origin in production, CORS-allowed in dev)
        ▼
Hono API server  (Node.js, server/)
        │
        ├── SQLite database  (data/gtfs.db, via better-sqlite3)
        │
        ├── Trafiklab Sweden 3 — GTFS static zip (stop/route/trip data)
        ├── Trafiklab Sweden 3 — GTFS-RT protobuf feeds (vehicles, trip updates, alerts)
        ├── Trafikverket Open Data API — road situation XML
        ├── ResRobot v2.1 — door-to-door journey planner
        └── Google Distance Matrix API — accurate walking times
```

There is no Supabase, no separate database server, and no cloud functions. Everything runs inside the single Node.js process.

## Tech stack

| Area | Libraries / tools |
|---|---|
| Frontend framework | React 18, TypeScript, Vite |
| UI components | shadcn/ui (Radix primitives), Tailwind CSS, Lucide icons |
| Mapping | OpenLayers 10, ol-mapbox-style |
| Backend framework | Hono 4 on `@hono/node-server` |
| Database | SQLite via `better-sqlite3` |
| Transit data format | GTFS static (zip/CSV) and GTFS-RT (protobuf via protobufjs) |
| Push notifications | Web Push API, `web-push` (VAPID) |
| Unit tests | Vitest, Testing Library |
| End-to-end tests | Playwright |
| Containerisation | Docker (multi-stage build), Docker Compose |
| Deployment | Google Cloud Build → Google Cloud Run |

## Project structure

```text
.
├── server/                  # Hono API server (Node.js)
│   ├── index.ts             # Entry point — wires up routes, auto-imports GTFS, starts push scheduler
│   ├── db.ts                # SQLite connection + schema bootstrap
│   └── routes/
│       ├── import.ts        # Downloads and parses the GTFS static zip from Trafiklab
│       ├── vehicles.ts      # Proxies the GTFS-RT vehicle positions feed
│       ├── trip-updates.ts  # Proxies the GTFS-RT trip updates feed (delays, cancellations)
│       ├── service-alerts.ts# Proxies the GTFS-RT alerts feed
│       ├── static-data.ts   # Serves stops / routes / stop-routes from SQLite
│       ├── stop-times.ts    # Serves stop times for one or many trips from SQLite
│       ├── situations.ts    # Fetches road situations from Trafikverket
│       ├── resrobot.ts      # Proxies ResRobot journey planner
│       ├── walk-distance.ts # Proxies Google Distance Matrix (walking times)
│       └── push.ts          # Manages push subscriptions and scheduled notifications
│
├── src/                     # React frontend
│   ├── main.tsx             # App entry point
│   ├── App.tsx              # Router setup
│   ├── contexts/
│   │   └── AppPreferencesContext.tsx  # Global preferences state (walk speed, language, etc.)
│   ├── pages/
│   │   ├── Index.tsx        # Main map page
│   │   ├── Settings.tsx     # Settings and saved places
│   │   └── NotFound.tsx
│   ├── components/
│   │   ├── BusMap.tsx       # OpenLayers map — vehicles, stops, user location, reach circles
│   │   ├── BusPopup.tsx     # Popup for a selected vehicle (stop times, speed, delay)
│   │   ├── StopPopup.tsx    # Popup for a selected stop (upcoming arrivals)
│   │   ├── CommuteDashboard.tsx  # Commute cards with leave guidance and push notifications
│   │   ├── BottomSheet.tsx  # Slide-up sheet used on mobile
│   │   ├── InstallBanner.tsx# iOS "add to home screen" prompt
│   │   ├── MapLocationPicker.tsx # Tap-to-pick a location on the map
│   │   ├── NavLink.tsx
│   │   ├── RefreshTimer.tsx
│   │   ├── SavedPlacesManager.tsx
│   │   └── ui/              # shadcn/ui base components
│   ├── hooks/
│   │   ├── useStaticData.ts      # Loads stops/routes/stop-routes; caches in sessionStorage
│   │   ├── useTripUpdates.ts     # Polls the trip-updates API
│   │   ├── useServiceAlerts.ts   # Polls the service-alerts API
│   │   ├── useRoadSituations.ts  # Fetches Trafikverket road situations
│   │   ├── useCommutePlans.ts    # Builds commute options from saved places + live data
│   │   ├── usePushNotifications.ts # Manages Service Worker push subscription lifecycle
│   │   ├── useFavoriteStops.ts   # Persists favourite stops in localStorage
│   │   ├── useSavedPlaces.ts     # Persists saved places in localStorage
│   │   ├── use-mobile.tsx
│   │   └── use-toast.ts
│   └── lib/
│       ├── api.ts            # Thin fetch wrapper — all calls go to /api/*
│       ├── preferences.ts    # Read/write user preferences from localStorage
│       ├── i18n.ts           # Localisation strings (British English + Swedish)
│       ├── savedPlaces.ts    # Saved place types and localStorage helpers
│       ├── stopGroups.ts     # Groups nearby stops so they cluster correctly on the map
│       ├── transitMatching.ts# Matches live vehicles to stops and calculates ETAs
│       ├── tripSchedules.ts  # Parses GTFS stop-time strings into Date objects
│       ├── staticDataCache.ts# sessionStorage cache for static GTFS data
│       ├── busIcon.ts        # Draws bus arrow icons onto a Canvas
│       ├── placeSearch.ts    # Nominatim geocoder for the place picker
│       └── utils.ts          # Tailwind class helpers
│
├── e2e/                     # Playwright end-to-end specs
├── public/                  # Static assets (icons, manifest)
├── docker/                  # (reserved — nginx.conf no longer used)
├── deploy/                  # GCP helper scripts
├── Dockerfile               # Multi-stage build: Vite frontend + tsc server → Node runtime
├── compose.yml              # Local Docker Compose setup
├── cloudbuild.yaml          # Google Cloud Build pipeline → Cloud Run
├── .env.example             # Template for local environment variables
├── vite.config.ts           # Vite config (proxies /api/* to the Hono server in dev)
├── vitest.config.ts
├── playwright.config.ts
├── tsconfig.json            # Shared base
├── tsconfig.app.json        # Frontend TypeScript config
├── tsconfig.server.json     # Server TypeScript config (outputs to dist-server/)
└── package.json
```

## Application routes

| Path | Description |
|---|---|
| `/` | Main map view with live vehicles, stop popups, and commute dashboard |
| `/settings` | User preferences (walk speed, language, stop zoom, saved places, favourites) |

## API endpoints

All endpoints live under `/api`. The frontend talks to them via the `src/lib/api.ts` wrapper.

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/static-data` | Returns stops, routes, and stop-routes from SQLite. Accepts a hash so the client can skip the download if nothing has changed. |
| `POST` | `/api/vehicles` | Fetches and decodes the GTFS-RT vehicle positions protobuf from Trafiklab; cached for 5 seconds. |
| `POST` | `/api/trip-updates` | Fetches and decodes the GTFS-RT trip updates protobuf (delays and cancellations). |
| `POST` | `/api/service-alerts` | Fetches and decodes the GTFS-RT service alerts protobuf. |
| `POST` | `/api/stop-times` | Queries SQLite for the stop sequence of one or many trips. |
| `POST` | `/api/situations` | Fetches road situations from Trafikverket for a given lat/lon/radius. |
| `POST` | `/api/resrobot/trip` | Proxies a journey-planner request to ResRobot and normalises the response. |
| `GET`  | `/api/walk-distance` | Proxies Google Distance Matrix for an accurate walking time between two coordinates. |
| `GET`  | `/api/push/vapid-public-key` | Returns the VAPID public key so the browser can create a push subscription. |
| `POST` | `/api/push/subscribe` | Saves or updates a push subscription in SQLite. |
| `POST` | `/api/push/schedule` | Stores a scheduled "time to leave" notification. |
| `POST` | `/api/import` | Manually triggers a GTFS static import (also runs automatically on startup). |
| `GET`  | `/api/health` | Returns `{ "status": "ok" }` — used by Docker and Cloud Run health checks. |

## Database

The server uses a single SQLite file at `data/gtfs.db` (configurable via `DB_PATH`). The schema is bootstrapped automatically in `server/db.ts` when the server starts — you do not need to run any migrations manually.

### Tables

| Table | Contents |
|---|---|
| `transit_stops` | Stop ID, name, latitude, longitude |
| `transit_routes` | Route ID, short name |
| `transit_trips` | Trip ID → route ID mapping |
| `stop_times` | Arrival and departure times per trip and stop sequence |
| `stop_routes` | Many-to-many mapping of stops to routes |
| `static_data_meta` | Tracks when the GTFS data was last imported and stores a hash for cache invalidation |
| `push_subscriptions` | Browser push subscriptions (endpoint, p256dh, auth) |
| `scheduled_notifications` | Pending "time to leave" push notifications |

### Automatic GTFS import

When the server starts it checks whether the database is empty or whether the static data is more than 7 days old. If either is true it downloads the GTFS zip from Trafiklab, parses it, and writes to SQLite. This keeps the data fresh without you having to run anything manually. The same check runs once every 24 hours while the server is running.

The Trafiklab static endpoint has a monthly download limit (50 requests), so the 7-day threshold is intentionally conservative.

## Getting started locally

### Prerequisites

- Node.js 22 (matches the Docker image)
- npm
- API keys (see below)

### 1. Copy the environment file

```bash
cp .env.example .env
```

Then fill in the values. See the [Environment variables](#environment-variables) section for details.

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development servers

The frontend (Vite on port 5173) and the backend (Hono on port 3000) need to run at the same time. The quickest way is:

```bash
npm run dev:all
```

This runs `npm run dev:server` and `npm run dev` in parallel. Vite's dev proxy forwards any request to `/api/*` to `http://localhost:3000`, so the frontend and backend appear to be on the same origin.

If you prefer two separate terminal windows:

```bash
# Terminal 1 — backend
npm run dev:server

# Terminal 2 — frontend
npm run dev
```

Open `http://localhost:5173` in a browser. The first time you start the backend it will download the GTFS data from Trafiklab, which takes a minute or two — watch the server logs.

## Environment variables

Copy `.env.example` to `.env` and fill in the values you need.

### Server-side variables (never sent to the browser)

| Variable | Required | Description |
|---|---|---|
| `TRAFIKLAB_SWEDEN3_RT_KEY` | Yes | API key for the Trafiklab Sweden 3 GTFS-RT feed (vehicle positions, trip updates, service alerts) |
| `TRAFIKLAB_SWEDEN3_STATIC_KEY` | Yes | API key for the Trafiklab Sweden 3 GTFS static zip download |
| `TRAFIKVERKET_OPEN_DATA_API_KEY` | Yes | API key for Trafikverket's Open Data API (road situations) |
| `RESROBOT_API_KEY` | Yes | API key for ResRobot v2.1 (journey planner) |
| `VAPID_PUBLIC_KEY` | Optional | VAPID public key for web push notifications |
| `VAPID_PRIVATE_KEY` | Optional | VAPID private key for web push notifications |
| `DB_PATH` | Optional | Path to the SQLite file. Defaults to `data/gtfs.db` in the working directory. |
| `PORT` | Optional | Port the Hono server listens on. Defaults to `3000` in dev and `8080` in the Docker image. |

### Build-time frontend variable (baked into the JS bundle)

| Variable | Required | Description |
|---|---|---|
| `VITE_GOOGLE_STREETVIEW_KEY` | Optional | Google API key used by the walk-distance route on the server side. The key is read from `process.env` on the server, but it must also be set as `VITE_GOOGLE_STREETVIEW_KEY` so that it is available at Docker build time via `--build-arg`. |

> **Note:** Variables starting with `VITE_` are bundled into the frontend JavaScript and are visible to anyone who inspects the page source. Do not put anything sensitive (service keys, secret tokens) in a `VITE_` variable.

### Generating VAPID keys

Push notifications are optional. If you want to enable them, generate a VAPID key pair once:

```bash
npx web-push generate-vapid-keys
```

Copy the output into your `.env` file.

## Available scripts

```bash
npm run dev            # Start the Vite frontend dev server (port 5173)
npm run dev:server     # Start the Hono backend with hot reload (port 3000)
npm run dev:all        # Start both together

npm run build          # Build the Vite frontend into dist/
npm run build:server   # Compile the server TypeScript into dist-server/
npm run build:all      # Build both

npm run start          # Run the compiled production server (serves frontend + API on one port)
npm run preview        # Preview the Vite production build locally

npm run lint           # ESLint
npm run test           # Vitest (run once)
npm run test:watch     # Vitest in watch mode
npm run e2e            # Playwright end-to-end tests
npm run e2e:headed     # Playwright in headed Edge for debugging
```

## Testing

### Unit tests

Unit tests use Vitest and Testing Library. Run them with:

```bash
npm run test
```

Test files live alongside the code they test (e.g. `src/lib/stopGroups.test.ts`, `src/components/StopPopup.test.ts`).

### End-to-end tests

Playwright specs live in `e2e/`. The config (`playwright.config.ts`) starts a Vite preview server automatically, so you just need to run:

```bash
npm run e2e
```

To run a specific file in a headed browser for debugging:

```bash
npm run e2e:headed
```

## VS Code setup

The `.vscode/` folder includes an `extensions.json` file that recommends the extensions most useful for this project:

- Playwright Test for VS Code
- Vitest explorer
- Docker
- ESLint

Open the Command Palette and run `Tasks: Run Task` to see the pre-configured tasks for installing dependencies, starting the dev server, building, and running tests.

## Docker

The `Dockerfile` uses a two-stage build:

1. **Build stage** — installs all dependencies, runs `vite build` to produce `dist/`, and runs `tsc -p tsconfig.server.json` to produce `dist-server/`.
2. **Runtime stage** — installs only production dependencies, copies `dist/` and `dist-server/` from the build stage, and runs the compiled server with Node.js.

In production the single Node.js process serves both the REST API on `/api/*` and the built frontend static files. There is no nginx.

### Build the image

The Google Streetview/Distance Matrix key needs to be available at build time so Vite can embed it:

```bash
docker build \
  --build-arg VITE_GOOGLE_STREETVIEW_KEY=your_key \
  -t ul-online:local .
```

### Run the container

Pass in the server-side API keys as environment variables:

```bash
docker run --rm -p 8080:8080 \
  -e TRAFIKLAB_SWEDEN3_RT_KEY=... \
  -e TRAFIKLAB_SWEDEN3_STATIC_KEY=... \
  -e TRAFIKVERKET_OPEN_DATA_API_KEY=... \
  -e RESROBOT_API_KEY=... \
  ul-online:local
```

The app is then available at `http://localhost:8080`.

### Run with Compose

Set the required variables in your shell or in a `.env` file, then:

```bash
docker compose up --build
```

The Compose file mounts a named volume at `/app/data` so the SQLite database persists across container restarts.

## Deployment

The project deploys to Google Cloud Run via Google Cloud Build. The pipeline is defined in `cloudbuild.yaml`.

What the pipeline does:

1. Fetches `VITE_GOOGLE_STREETVIEW_KEY` from GCP Secret Manager and passes it as a Docker build arg.
2. Builds and pushes the Docker image to Artifact Registry.
3. Deploys the image to Cloud Run, injecting the server-side secrets (`TRAFIKLAB_SWEDEN3_RT_KEY`, `TRAFIKLAB_SWEDEN3_STATIC_KEY`, `TRAFIKVERKET_OPEN_DATA_API_KEY`, `RESROBOT_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) directly from Secret Manager.

The default substitutions in `cloudbuild.yaml` target the `stage` environment in `europe-north1`. Override `_ENV`, `_REGION`, and `_TAG` when triggering a production build.

Helper scripts for setting up the GCP project and Cloud Run service are in `deploy/`.

## User preferences

All preferences are stored in `localStorage` in the browser. There is no user account system. The preferences are:

| Preference | Default | Description |
|---|---|---|
| Walk speed | 4 km/h | Used to calculate walk time to stops and for the commute planner |
| Buffer time | 5 minutes | Extra padding added to walk time before deciding "leave now" vs "leave soon" |
| Max walk distance | 1000 m | Stops further than this are excluded from commute planning |
| High-accuracy location | Off | Uses the `enableHighAccuracy` GPS option |
| Stop visibility zoom | 12 | The map zoom level at which stop markers start appearing |
| Language | System default | British English (`en-GB`) or Swedish (`sv-SE`), or follow the browser/OS |

## Contributing

Contributions are welcome. If you open a PR, please include:

- a short summary of what changed and why
- screenshots for any UI changes
- updated setup notes if configuration or environment variables changed

Keep changes focused and well-described — this makes it much easier to review and understand the history of the project.
