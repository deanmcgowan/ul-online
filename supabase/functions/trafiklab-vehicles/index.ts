// DEPRECATED: This Supabase Edge Function is no longer used.
// The application now uses the Hono server in server/routes/vehicles.ts
// which fetches GTFS-RT Sweden 3 vehicle positions directly.
// This file is kept for reference only and should not be deployed.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import protobuf from "npm:protobufjs@7.4.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROTO_DEF = `
syntax = "proto2";
package transit_realtime;

message FeedMessage {
  required FeedHeader header = 1;
  repeated FeedEntity entity = 2;
}
message FeedHeader {
  required string gtfs_realtime_version = 1;
  optional uint64 timestamp = 3;
}
message FeedEntity {
  required string id = 1;
  optional VehiclePosition vehicle = 4;
}
message VehiclePosition {
  optional TripDescriptor trip = 1;
  optional Position position = 2;
  optional uint32 current_stop_sequence = 3;
  optional VehicleStopStatus current_status = 4;
  optional uint64 timestamp = 5;
  optional string stop_id = 7;
  optional VehicleDescriptor vehicle_desc = 8;
}
enum VehicleStopStatus {
  INCOMING_AT = 0;
  STOPPED_AT = 1;
  IN_TRANSIT_TO = 2;
}
message Position {
  required float latitude = 1;
  required float longitude = 2;
  optional float bearing = 3;
  optional float speed = 5;
}
message TripDescriptor {
  optional string trip_id = 1;
  optional string start_time = 2;
  optional string start_date = 3;
  optional string route_id = 5;
  optional uint32 direction_id = 6;
}
message VehicleDescriptor {
  optional string id = 1;
  optional string label = 2;
}
`;

let cachedRoot: protobuf.Root | null = null;
const TRIP_ROUTE_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const tripRouteCache = new Map<string, { routeId: string; expiresAt: number }>();
const VEHICLE_STOP_STATUS: Record<number, "INCOMING_AT" | "STOPPED_AT" | "IN_TRANSIT_TO"> = {
  0: "INCOMING_AT",
  1: "STOPPED_AT",
  2: "IN_TRANSIT_TO",
};

function getRoot() {
  if (!cachedRoot) {
    cachedRoot = protobuf.parse(PROTO_DEF).root;
  }
  return cachedRoot;
}

function getCachedRouteId(tripId: string): string | null {
  const cached = tripRouteCache.get(tripId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    tripRouteCache.delete(tripId);
    return null;
  }
  return cached.routeId;
}

function setCachedRouteId(tripId: string, routeId: string) {
  tripRouteCache.set(tripId, {
    routeId,
    expiresAt: Date.now() + TRIP_ROUTE_CACHE_TTL_MS,
  });
}

function pruneTripRouteCache() {
  if (tripRouteCache.size < 5000) return;

  const now = Date.now();
  for (const [tripId, entry] of tripRouteCache.entries()) {
    if (entry.expiresAt <= now) {
      tripRouteCache.delete(tripId);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    pruneTripRouteCache();
    const apiKey = Deno.env.get("TRAFIKLAB_GTFS_RT_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://opendata.samtrafiken.se/gtfs-rt-sweden/ul/VehiclePositionsSweden.pb?key=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Trafiklab error: ${response.status}` }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const buffer = await response.arrayBuffer();
    const root = getRoot();
    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
    const feed = FeedMessage.decode(new Uint8Array(buffer));
    const feedObj = FeedMessage.toObject(feed, {
      longs: Number,
      defaults: true,
    });

    const vehicles = (feedObj.entity || [])
      .filter(
        (e: any) => e.vehicle && e.vehicle.position
      )
      .map((e: any) => ({
        id: e.id,
        tripId: e.vehicle.trip?.tripId || "",
        routeId: e.vehicle.trip?.routeId || "",
        directionId: e.vehicle.trip?.directionId || 0,
        currentStatus: VEHICLE_STOP_STATUS[e.vehicle.currentStatus] || "",
        lat: e.vehicle.position.latitude,
        lon: e.vehicle.position.longitude,
        bearing: e.vehicle.position.bearing || 0,
        speed: e.vehicle.position.speed || 0,
        stopId: e.vehicle.stopId || "",
        currentStopSequence: e.vehicle.currentStopSequence || 0,
        vehicleId: e.vehicle.vehicleDesc?.id || "",
        vehicleLabel: e.vehicle.vehicleDesc?.label || "",
        timestamp: e.vehicle.timestamp || 0,
      }));

    // Look up route_id from transit_trips for vehicles missing routeId
    const tripIdsToResolve = [...new Set(
      vehicles
        .filter((v: any) => !v.routeId && v.tripId)
        .map((v: any) => v.tripId)
        .filter((tripId: string) => !getCachedRouteId(tripId))
    )];

    if (tripIdsToResolve.length > 0) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        // Fetch in batches of 500 (Supabase filter limit)
        const tripRouteMap = new Map<string, string>();
        for (let i = 0; i < tripIdsToResolve.length; i += 500) {
          const batch = tripIdsToResolve.slice(i, i + 500);
          const { data } = await supabase
            .from("transit_trips")
            .select("trip_id, route_id")
            .in("trip_id", batch);
          if (data) {
            data.forEach((row: any) => {
              if (row.route_id) {
                tripRouteMap.set(row.trip_id, row.route_id);
                setCachedRouteId(row.trip_id, row.route_id);
              }
            });
          }
        }

        // Fill in routeId from DB lookup
        vehicles.forEach((v: any) => {
          if (!v.routeId && v.tripId) {
            v.routeId = tripRouteMap.get(v.tripId) || getCachedRouteId(v.tripId) || "";
          }
        });
      } catch (e) {
        console.error("Trip lookup error:", e.message);
      }
    } else {
      vehicles.forEach((v: any) => {
        if (!v.routeId && v.tripId) {
          v.routeId = getCachedRouteId(v.tripId) || "";
        }
      });
    }

    return new Response(
      JSON.stringify({ vehicles, timestamp: feedObj.header?.timestamp }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
