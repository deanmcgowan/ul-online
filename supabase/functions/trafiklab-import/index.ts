import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("TRAFIKLAB_GTFS_STATIC_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Static API key not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Create tables if they don't exist (bypasses migration system)
    const { error: sqlErr } = await supabase.rpc("__create_transit_tables").maybeSingle();
    // Ignore RPC error - tables might already exist or function might not exist
    // Try direct SQL via REST if available
    await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/__create_transit_tables`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
    }).catch(() => {});

    // Ensure tables exist by attempting to create via raw SQL through the DB connection
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (dbUrl) {
      try {
        const { Client } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
        const client = new Client(dbUrl);
        await client.connect();
        await client.queryArray(`
          CREATE TABLE IF NOT EXISTS public.transit_stops (
            stop_id TEXT PRIMARY KEY, stop_name TEXT NOT NULL,
            stop_lat DOUBLE PRECISION NOT NULL, stop_lon DOUBLE PRECISION NOT NULL
          );
          CREATE TABLE IF NOT EXISTS public.transit_routes (
            route_id TEXT PRIMARY KEY, route_short_name TEXT DEFAULT '',
            route_long_name TEXT DEFAULT '', route_type INTEGER DEFAULT 3
          );
          CREATE TABLE IF NOT EXISTS public.transit_trips (
            trip_id TEXT PRIMARY KEY, route_id TEXT DEFAULT ''
          );
          CREATE TABLE IF NOT EXISTS public.stop_routes (
            stop_id TEXT NOT NULL, route_id TEXT NOT NULL, PRIMARY KEY (stop_id, route_id)
          );
          ALTER TABLE public.transit_stops ENABLE ROW LEVEL SECURITY;
          ALTER TABLE public.transit_routes ENABLE ROW LEVEL SECURITY;
          ALTER TABLE public.transit_trips ENABLE ROW LEVEL SECURITY;
          ALTER TABLE public.stop_routes ENABLE ROW LEVEL SECURITY;
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='transit_stops' AND policyname='read_stops') THEN
              CREATE POLICY read_stops ON public.transit_stops FOR SELECT USING (true);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='transit_routes' AND policyname='read_routes') THEN
              CREATE POLICY read_routes ON public.transit_routes FOR SELECT USING (true);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='transit_trips' AND policyname='read_trips') THEN
              CREATE POLICY read_trips ON public.transit_trips FOR SELECT USING (true);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stop_routes' AND policyname='read_stop_routes') THEN
              CREATE POLICY read_stop_routes ON public.stop_routes FOR SELECT USING (true);
            END IF;
          END $$;
        `);
        await client.end();
        console.log("Tables created/verified successfully");
      } catch (e) {
        console.error("DB table creation error:", e.message);
      }
    }

    // Download GTFS Sweden static zip
    const url = `https://opendata.samtrafiken.se/gtfs-sweden/sweden.zip?key=${apiKey}`;
    console.log("Downloading GTFS data...");
    const response = await fetch(url);

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: `GTFS download failed: ${response.status} ${response.statusText}`,
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const zipBuffer = await response.arrayBuffer();
    console.log(`Downloaded ${(zipBuffer.byteLength / 1024 / 1024).toFixed(1)}MB`);

    const zip = await JSZip.loadAsync(zipBuffer);

    // Parse stops.txt
    console.log("Parsing stops...");
    const stopsText = await zip.file("stops.txt")?.async("text");
    if (!stopsText) throw new Error("stops.txt not found in GTFS zip");

    const allStops = parseCSV(stopsText);

    // Filter for Uppsala region (lat 59.5-60.3, lon 17.0-18.2)
    const uppsalaStops = allStops
      .filter((s) => {
        const lat = parseFloat(s.stop_lat);
        const lon = parseFloat(s.stop_lon);
        return lat >= 59.5 && lat <= 60.3 && lon >= 17.0 && lon <= 18.2;
      })
      .map((s) => ({
        stop_id: s.stop_id,
        stop_name: s.stop_name,
        stop_lat: parseFloat(s.stop_lat),
        stop_lon: parseFloat(s.stop_lon),
      }));

    console.log(`Found ${uppsalaStops.length} Uppsala-region stops`);

    // Insert stops in batches
    const BATCH_SIZE = 500;
    for (let i = 0; i < uppsalaStops.length; i += BATCH_SIZE) {
      const batch = uppsalaStops.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("transit_stops")
        .upsert(batch, { onConflict: "stop_id" });
      if (error) throw new Error(`Stops insert error: ${error.message}`);
    }

    // Parse routes.txt
    console.log("Parsing routes...");
    const routesText = await zip.file("routes.txt")?.async("text");
    if (!routesText) throw new Error("routes.txt not found in GTFS zip");

    const allRoutes = parseCSV(routesText);
    const routes = allRoutes.map((r) => ({
      route_id: r.route_id,
      route_short_name: r.route_short_name || "",
      route_long_name: r.route_long_name || "",
      route_type: parseInt(r.route_type) || 3,
    }));

    console.log(`Found ${routes.length} routes`);

    for (let i = 0; i < routes.length; i += BATCH_SIZE) {
      const batch = routes.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("transit_routes")
        .upsert(batch, { onConflict: "route_id" });
      if (error) throw new Error(`Routes insert error: ${error.message}`);
    }

    // Build stop_routes mapping from trips.txt + stop_times.txt
    console.log("Building stop_routes mapping...");
    const uppsalaStopIds = new Set(uppsalaStops.map((s) => s.stop_id));

    const tripsText = await zip.file("trips.txt")?.async("text");
    let stopRoutesCount = 0;

    if (tripsText) {
      const trips = parseCSV(tripsText);
      const tripToRoute = new Map<string, string>();
      const tripRows: { trip_id: string; route_id: string }[] = [];
      trips.forEach((t) => {
        tripToRoute.set(t.trip_id, t.route_id);
        tripRows.push({ trip_id: t.trip_id, route_id: t.route_id });
      });

      console.log(`Found ${tripRows.length} trips, inserting...`);
      for (let i = 0; i < tripRows.length; i += BATCH_SIZE) {
        const batch = tripRows.slice(i, i + BATCH_SIZE);
        await supabase.from("transit_trips").upsert(batch, { onConflict: "trip_id" });
      }

      const stopTimesText = await zip.file("stop_times.txt")?.async("text");
      if (stopTimesText) {
        const stopRouteSet = new Set<string>();
        const lines = stopTimesText.trim().split("\n");
        const headers = parseCSVLine(lines[0]);
        const tripIdIdx = headers.indexOf("trip_id");
        const stopIdIdx = headers.indexOf("stop_id");

        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          const stopId = values[stopIdIdx];
          if (uppsalaStopIds.has(stopId)) {
            const tripId = values[tripIdIdx];
            const routeId = tripToRoute.get(tripId);
            if (routeId) {
              stopRouteSet.add(`${stopId}|||${routeId}`);
            }
          }
        }

        const stopRoutes = Array.from(stopRouteSet).map((key) => {
          const [stop_id, route_id] = key.split("|||");
          return { stop_id, route_id };
        });

        console.log(`Found ${stopRoutes.length} stop-route associations`);

        for (let i = 0; i < stopRoutes.length; i += BATCH_SIZE) {
          const batch = stopRoutes.slice(i, i + BATCH_SIZE);
          const { error } = await supabase
            .from("stop_routes")
            .upsert(batch, { onConflict: "stop_id,route_id" });
          if (error)
            console.error(`stop_routes batch error: ${error.message}`);
        }
        stopRoutesCount = stopRoutes.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        stops_imported: uppsalaStops.length,
        routes_imported: routes.length,
        stop_routes_imported: stopRoutesCount,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Import error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
