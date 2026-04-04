import { Hono } from "hono";
import JSZip from "jszip";
import { getDb } from "../db.js";

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] || "";
    });
    return obj;
  });
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export const importRoute = new Hono();

importRoute.post("/", async (c) => {
  const apiKey = process.env.TRAFIKLAB_SWEDEN3_STATIC_KEY;
  if (!apiKey) {
    return c.json({ error: "Sweden 3 Static API key not configured" }, 500);
  }

  const db = getDb();

  const url = `https://opendata.samtrafiken.se/gtfs/ul/ul.zip?key=${apiKey}`;
  console.log("Downloading GTFS Sweden 3 UL data...");
  const response = await fetch(url);
  if (!response.ok) {
    return c.json(
      { error: `GTFS download failed: ${response.status} ${response.statusText}` },
      response.status as 400
    );
  }

  const zipBuffer = await response.arrayBuffer();
  console.log(`Downloaded ${(zipBuffer.byteLength / 1024 / 1024).toFixed(1)}MB`);
  const zip = await JSZip.loadAsync(zipBuffer);

  // Parse stops
  console.log("Parsing stops...");
  const stopsText = await zip.file("stops.txt")?.async("text");
  if (!stopsText) throw new Error("stops.txt not found in GTFS zip");

  const allStops = parseCSV(stopsText)
    .map((s) => ({
      stop_id: s.stop_id,
      stop_name: s.stop_name,
      stop_lat: parseFloat(s.stop_lat),
      stop_lon: parseFloat(s.stop_lon),
    }))
    .filter((s) => !isNaN(s.stop_lat) && !isNaN(s.stop_lon));

  console.log(`Found ${allStops.length} stops`);

  // Use a transaction for the entire import
  const importAll = db.transaction(() => {
    // Upsert stops
    const upsertStop = db.prepare(
      `INSERT INTO transit_stops (stop_id, stop_name, stop_lat, stop_lon)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(stop_id) DO UPDATE SET stop_name=excluded.stop_name, stop_lat=excluded.stop_lat, stop_lon=excluded.stop_lon`
    );
    for (const s of allStops) {
      upsertStop.run(s.stop_id, s.stop_name, s.stop_lat, s.stop_lon);
    }

    return { stopsCount: allStops.length };
  });

  const { stopsCount } = importAll();

  // Parse routes
  console.log("Parsing routes...");
  const routesText = await zip.file("routes.txt")?.async("text");
  if (!routesText) throw new Error("routes.txt not found in GTFS zip");

  const routes = parseCSV(routesText).map((r) => ({
    route_id: r.route_id,
    route_short_name: r.route_short_name || "",
    route_long_name: r.route_long_name || "",
    route_type: parseInt(r.route_type) || 3,
  }));
  console.log(`Found ${routes.length} routes`);

  const importRoutes = db.transaction(() => {
    const upsertRoute = db.prepare(
      `INSERT INTO transit_routes (route_id, route_short_name, route_long_name, route_type)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(route_id) DO UPDATE SET route_short_name=excluded.route_short_name, route_long_name=excluded.route_long_name, route_type=excluded.route_type`
    );
    for (const r of routes) {
      upsertRoute.run(r.route_id, r.route_short_name, r.route_long_name, r.route_type);
    }
  });

  importRoutes();

  // Parse trips
  console.log("Parsing trips...");
  const tripsText = await zip.file("trips.txt")?.async("text");
  const tripToRoute = new Map<string, string>();
  if (tripsText) {
    const trips = parseCSV(tripsText);
    const importTrips = db.transaction(() => {
      const upsertTrip = db.prepare(
        `INSERT INTO transit_trips (trip_id, route_id) VALUES (?, ?)
         ON CONFLICT(trip_id) DO UPDATE SET route_id=excluded.route_id`
      );
      for (const t of trips) {
        tripToRoute.set(t.trip_id, t.route_id);
        upsertTrip.run(t.trip_id, t.route_id);
      }
    });
    importTrips();
    console.log(`Found ${tripToRoute.size} trips`);
  }

  // Parse stop_times and build stop_routes
  console.log("Parsing stop_times...");
  const stopTimesText = await zip.file("stop_times.txt")?.async("text");
  let stopRoutesCount = 0;
  const stopIds = new Set(allStops.map((s) => s.stop_id));

  if (stopTimesText) {
    const lines = stopTimesText.trim().split("\n");
    const headers = parseCSVLine(lines[0]);
    const tripIdIdx = headers.indexOf("trip_id");
    const stopIdIdx = headers.indexOf("stop_id");
    const seqIdx = headers.indexOf("stop_sequence");
    const arrIdx = headers.indexOf("arrival_time");
    const depIdx = headers.indexOf("departure_time");

    const stopRouteSet = new Set<string>();

    // Clear old stop_times
    console.log("Clearing old stop_times...");
    db.exec("DELETE FROM stop_times");

    // Insert stop_times in a transaction  
    const BATCH_SIZE = 5000;
    const upsertST = db.prepare(
      `INSERT INTO stop_times (trip_id, stop_id, stop_sequence, arrival_time, departure_time)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(trip_id, stop_sequence) DO UPDATE SET
         stop_id=excluded.stop_id, arrival_time=excluded.arrival_time, departure_time=excluded.departure_time`
    );

    let batch: { tripId: string; stopId: string; seq: number; arr: string; dep: string }[] = [];
    let totalST = 0;

    const flushBatch = db.transaction(
      (items: typeof batch) => {
        for (const item of items) {
          upsertST.run(item.tripId, item.stopId, item.seq, item.arr, item.dep);
        }
      }
    );

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const tripId = values[tripIdIdx];
      const stopId = values[stopIdIdx];
      if (!tripId) continue;

      const routeId = tripToRoute.get(tripId);
      if (stopIds.has(stopId) && routeId) {
        stopRouteSet.add(`${stopId}|||${routeId}`);
      }

      batch.push({
        tripId,
        stopId,
        seq: parseInt(values[seqIdx]) || 0,
        arr: values[arrIdx] || "",
        dep: values[depIdx] || "",
      });

      if (batch.length >= BATCH_SIZE) {
        flushBatch(batch);
        totalST += batch.length;
        batch = [];
      }
    }

    if (batch.length > 0) {
      flushBatch(batch);
      totalST += batch.length;
    }
    console.log(`Imported ${totalST} stop_times rows`);

    // Insert stop_routes
    const stopRoutes = Array.from(stopRouteSet).map((key) => {
      const [sid, rid] = key.split("|||");
      return { stop_id: sid, route_id: rid };
    });

    const importStopRoutes = db.transaction(() => {
      const upsertSR = db.prepare(
        `INSERT INTO stop_routes (stop_id, route_id) VALUES (?, ?)
         ON CONFLICT(stop_id, route_id) DO NOTHING`
      );
      for (const sr of stopRoutes) {
        upsertSR.run(sr.stop_id, sr.route_id);
      }
    });
    importStopRoutes();
    stopRoutesCount = stopRoutes.length;
    console.log(`Found ${stopRoutesCount} stop-route associations`);
  }

  // Compute combined hash
  const hashInput = `${stopsCount}-${routes.length}-${stopRoutesCount}-${Date.now()}`;
  const combinedHash = simpleHash(hashInput);

  db.prepare(
    `INSERT INTO static_data_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).run("combined_hash", combinedHash, new Date().toISOString());

  console.log(
    `Import complete: ${stopsCount} stops, ${routes.length} routes, ${stopRoutesCount} stop_routes, hash: ${combinedHash}`
  );

  return c.json({
    success: true,
    stops_imported: stopsCount,
    routes_imported: routes.length,
    stop_routes_imported: stopRoutesCount,
    hash: combinedHash,
  });
});
