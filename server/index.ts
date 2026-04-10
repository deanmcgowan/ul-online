import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import path from "node:path";
import fs from "node:fs";

import { staticDataRoute } from "./routes/static-data.js";
import { vehiclesRoute } from "./routes/vehicles.js";
import { situationsRoute } from "./routes/situations.js";
import { stopTimesRoute } from "./routes/stop-times.js";
import { tripUpdatesRoute } from "./routes/trip-updates.js";
import { serviceAlertsRoute } from "./routes/service-alerts.js";
import { importRoute, runGtfsImport } from "./routes/import.js";
import { resrobotRoute } from "./routes/resrobot.js";
import { pushRoute, startPushScheduler } from "./routes/push.js";
import { walkDistanceRoute } from "./routes/walk-distance.js";
import { getDb } from "./db.js";

const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors());

// ── API routes ──────────────────────────────────────────────
app.route("/api/static-data", staticDataRoute);
app.route("/api/vehicles", vehiclesRoute);
app.route("/api/situations", situationsRoute);
app.route("/api/stop-times", stopTimesRoute);
app.route("/api/trip-updates", tripUpdatesRoute);
app.route("/api/service-alerts", serviceAlertsRoute);
app.route("/api/resrobot", resrobotRoute);
app.route("/api/push", pushRoute);
app.route("/api/walk-distance", walkDistanceRoute);
app.route("/api/import", importRoute);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok" }));

// ── Static file serving (production) ────────────────────────
const distDir = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  // Serve assets with long cache
  app.use(
    "/assets/*",
    serveStatic({
      root: "./dist",
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    })
  );

  // Serve other static files
  app.use(
    "*",
    serveStatic({
      root: "./dist",
      rewriteRequestPath: (reqPath) => {
        // SPA fallback: if file doesn't exist, serve index.html
        const filePath = path.join(distDir, reqPath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          return reqPath;
        }
        return "/index.html";
      },
    })
  );
}

// Ensure data directory exists before initializing DB
const dbDir = path.dirname(process.env.DB_PATH || path.join(process.cwd(), "data", "gtfs.db"));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Ensure DB is initialized on startup
getDb();

// Auto-import GTFS data if the DB is empty (no seeded data) or very stale (>7 days)
// Static GTFS download limit: 50/month — be conservative with re-downloads
const STALE_DAYS = 7;
let importRunning = false;

function shouldImport(): "empty" | "stale" | false {
  const db = getDb();
  const stopsCount = db.prepare("SELECT COUNT(*) AS n FROM transit_stops").get() as { n: number };
  if (stopsCount.n === 0) return "empty";

  const meta = db.prepare("SELECT updated_at FROM static_data_meta WHERE key = ?").get("combined_hash") as { updated_at: string } | undefined;
  if (meta?.updated_at) {
    const age = Date.now() - new Date(meta.updated_at).getTime();
    if (age > STALE_DAYS * 24 * 60 * 60 * 1000) return "stale";
  }
  return false;
}

function triggerImportIfNeeded() {
  if (importRunning) return;
  const reason = shouldImport();
  if (!reason) return;

  importRunning = true;
  console.log(`GTFS data ${reason} — running import...`);
  runGtfsImport()
    .then((result) => console.log("Import complete:", result))
    .catch((err) => console.error("Import failed:", err))
    .finally(() => { importRunning = false; });
}

triggerImportIfNeeded();

// Check for stale data once per day (static GTFS download limit: 50/month)
setInterval(triggerImportIfNeeded, 24 * 60 * 60 * 1000);

// Start push notification scheduler
startPushScheduler();

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`Starting server on port ${port}`);
serve({ fetch: app.fetch, port });
