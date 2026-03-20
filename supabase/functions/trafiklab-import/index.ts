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
      trips.forEach((t) => tripToRoute.set(t.trip_id, t.route_id));

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
