import { Hono } from "hono";
import { getDb } from "../db.js";

export const stopTimesRoute = new Hono();

/** POST /api/stop-times  { tripId } | { tripIds } */
stopTimesRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = getDb();

  // Single trip (BusPopup)
  if (body.tripId && !body.tripIds) {
    const rows = db
      .prepare(
        `SELECT stop_id, stop_sequence, arrival_time, departure_time
         FROM stop_times WHERE trip_id = ?
         ORDER BY stop_sequence ASC`
      )
      .all(body.tripId);
    return c.json({ data: rows });
  }

  // Multiple trips (StopPopup, CommutePlans)
  if (body.tripIds && Array.isArray(body.tripIds)) {
    const ids: string[] = body.tripIds.slice(0, 500); // safety cap
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT trip_id, stop_id, stop_sequence, arrival_time, departure_time
         FROM stop_times WHERE trip_id IN (${placeholders})`
      )
      .all(...ids);
    return c.json({ data: rows });
  }

  return c.json({ data: [] });
});
