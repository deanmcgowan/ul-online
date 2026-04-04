import { Hono } from "hono";
import { getDb } from "../db.js";

const PAGE = 1000;

function fetchAll(db: ReturnType<typeof getDb>, table: string) {
  const columns =
    table === "transit_stops"
      ? "stop_id, stop_name, stop_lat, stop_lon"
      : table === "transit_routes"
        ? "route_id, route_short_name"
        : "stop_id, route_id";
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const rows = db
      .prepare(`SELECT ${columns} FROM ${table} LIMIT ? OFFSET ?`)
      .all(PAGE, offset) as Record<string, unknown>[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export const staticDataRoute = new Hono();

staticDataRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const clientHash: string = body.hash || "";
  const dataset: string = body.dataset || "all";
  const db = getDb();

  // Quick hash check
  if (clientHash && dataset === "all") {
    const meta = db
      .prepare("SELECT value FROM static_data_meta WHERE key = ?")
      .get("combined_hash") as { value: string } | undefined;
    if (meta?.value && meta.value === clientHash) {
      return c.json({ unchanged: true, hash: clientHash });
    }
  }

  const results: Record<string, unknown> = {};

  if (dataset === "all" || dataset === "stops") {
    results.stops = fetchAll(db, "transit_stops");
  }
  if (dataset === "all" || dataset === "routes") {
    results.routes = fetchAll(db, "transit_routes");
  }
  if (dataset === "all" || dataset === "stopRoutes") {
    results.stopRoutes = fetchAll(db, "stop_routes");
  }

  const hashMeta = db
    .prepare("SELECT value FROM static_data_meta WHERE key = ?")
    .get("combined_hash") as { value: string } | undefined;

  return c.json({
    unchanged: false,
    hash: hashMeta?.value || "initial",
    ...results,
  });
});
