# Development Guide

Everything you need to get the project running locally, run the tests, and build for production.

For environment variables and API key setup, see [Configuration](Configuration) first.

---

## Running locally

Install dependencies:

```bash
npm install
```

Copy the example environment file and fill in your Supabase values:

```bash
cp .env.example .env
# edit .env with your VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
```

Start the Vite dev server:

```bash
npm run dev
```

The app will be available at `http://localhost:8080` (or the next available port — Vite will print the URL).

Hot module replacement is active, so most changes take effect immediately without a full page reload.

---

## Available scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Start the Vite development server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint across the codebase |
| `npm run test` | Run all Vitest unit tests once |
| `npm run test:watch` | Run Vitest in watch mode |

---

## VS Code setup

The repository includes a `.vscode/` directory with pre-configured launch profiles and tasks.

### Recommended extensions

- **Playwright Test** — run and debug e2e tests from the sidebar
- **Vitest Explorer** — run and debug unit tests from the Testing panel
- **Docker** — manage the container from within the editor
- **ESLint** — inline linting as you type

### Run and Debug profiles

Open the **Run and Debug** panel and select one of:

- `Frontend: Edge` — starts the Vite server and attaches the browser debugger to `http://localhost:8080`
- `Vitest: current file` — steps through the currently open test file
- `Playwright: current file` — runs the currently open e2e spec in headed Microsoft Edge

### Tasks

Open the Command Palette and run **Tasks: Run Task** to access shortcuts for:

- Install dependencies
- Start dev server
- Build
- Preview build
- Run Vitest
- Run Playwright
- Build and run Docker image

---

## Unit tests (Vitest)

Tests live alongside the code they cover or under `src/test/`. Run them with:

```bash
npm run test
npm run test:watch   # for TDD-style development
```

The Vitest Explorer in VS Code lets you run individual tests and step through failures in the debugger.

---

## End-to-end tests (Playwright)

Playwright specs live in `e2e/`. The test runner is configured to start a Vite preview server on port `4173` automatically.

Run all specs:

```bash
npx playwright test
```

Run a single file in headed mode for debugging:

```bash
npx playwright test e2e/your-spec.ts --headed
```

Or use the `Playwright: current file` launch profile in VS Code.

---

## Docker

The Dockerfile uses a multi-stage build: Node.js compiles the Vite bundle, then nginx serves the static files.

### Build the image

Vite bakes environment variables into the bundle at build time, so pass them as build arguments:

```bash
docker build \
  --build-arg VITE_SUPABASE_URL=https://xxxx.supabase.co \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=eyJ... \
  -t ul-online:local .
```

### Run the container

```bash
docker run --rm -p 8080:80 ul-online:local
```

### Run with Compose

Export your two public variables (or set them in a `.env` file that Compose will pick up), then:

```bash
docker compose up --build
```

The nginx config (`docker/nginx.conf`) handles SPA routing (all paths fall through to `index.html`) and sets appropriate cache headers for static assets.

---

## Supabase local development

If you want to run Supabase locally rather than against a cloud project, install the [Supabase CLI](https://supabase.com/docs/guides/cli) and run:

```bash
supabase start
```

This spins up a local Postgres instance with the Studio dashboard, Auth, and Edge Functions runtime.

Apply the migrations:

```bash
supabase db push
```

Deploy the Edge Functions locally:

```bash
supabase functions serve
```

Set function secrets for local development:

```bash
supabase secrets set --env-file .env.local
```

Run the static import function once to populate the database with stops, routes, and trips:

```bash
supabase functions invoke trafiklab-import
```

---

## Linting

ESLint is configured in `eslint.config.js`. Run it with:

```bash
npm run lint
```

The project uses TypeScript strict mode — the `tsconfig.app.json`, `tsconfig.node.json`, and `tsconfig.server.json` files each cover a different part of the build (frontend, Vite config, and server code respectively).

---

## Project structure reference

```text
.
├── public/            Static assets — manifest, icons, service worker
├── src/
│   ├── components/    React components
│   ├── contexts/      React context providers (AppPreferencesContext)
│   ├── hooks/         Custom hooks (data fetching, preferences, etc.)
│   ├── lib/           Pure utility functions and types
│   ├── pages/         Route-level page components
│   └── test/          Shared test helpers
├── e2e/               Playwright end-to-end specs
├── supabase/
│   ├── functions/     Edge Function source (Deno + TypeScript)
│   └── migrations/    SQL migration files
├── docker/            nginx config for the Docker image
├── .vscode/           VS Code launch profiles and tasks
└── wiki/              This wiki (markdown + SVG diagrams)
```
