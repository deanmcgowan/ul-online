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
import { importRoute } from "./routes/import.js";
import { getDb } from "./db.js";

const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors());

// ── API routes ──────────────────────────────────────────────
app.route("/api/static-data", staticDataRoute);
app.route("/api/vehicles", vehiclesRoute);
app.route("/api/situations", situationsRoute);
app.route("/api/stop-times", stopTimesRoute);
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

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`Starting server on port ${port}`);
serve({ fetch: app.fetch, port });
