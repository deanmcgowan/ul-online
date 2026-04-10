import { Hono } from "hono";
import protobuf from "protobufjs";
import { getDb } from "../db.js";

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
const VEHICLE_STOP_STATUS: Record<number, string> = {
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

export const vehiclesRoute = new Hono();

// In-memory cache: serve cached data if less than 5 seconds old
let cache: { data: { vehicles: any[]; timestamp: number }; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5_000;

vehiclesRoute.post("/", async (c) => {
  const now = Date.now();

  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return c.json(cache.data);
  }

  pruneTripRouteCache();

  const apiKey = process.env.TRAFIKLAB_SWEDEN3_RT_KEY;
  if (!apiKey) {
    return c.json({ error: "API key not configured" }, 500);
  }

  const url = `https://opendata.samtrafiken.se/gtfs-rt-sweden/ul/VehiclePositionsSweden.pb?key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) {
    return c.json({ error: `Trafiklab error: ${response.status}` }, response.status as 400);
  }

  const buffer = await response.arrayBuffer();
  const root = getRoot();
  const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
  const feed = FeedMessage.decode(new Uint8Array(buffer));
  const feedObj = FeedMessage.toObject(feed, { longs: Number, defaults: true }) as Record<string, any>;

  const vehicles = ((feedObj.entity || []) as any[])
    .filter((e: any) => e.vehicle && e.vehicle.position && e.vehicle.trip?.tripId)
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
  const tripIdsToResolve = [
    ...new Set(
      vehicles
        .filter((v) => !v.routeId && v.tripId)
        .map((v) => v.tripId)
        .filter((tripId: string) => !getCachedRouteId(tripId))
    ),
  ];

  if (tripIdsToResolve.length > 0) {
    try {
      const db = getDb();
      const placeholders = tripIdsToResolve.map(() => "?").join(",");
      const rows = db
        .prepare(`SELECT trip_id, route_id FROM transit_trips WHERE trip_id IN (${placeholders})`)
        .all(...tripIdsToResolve) as { trip_id: string; route_id: string }[];

      for (const row of rows) {
        if (row.route_id) {
          setCachedRouteId(row.trip_id, row.route_id);
        }
      }

      for (const v of vehicles) {
        if (!v.routeId && v.tripId) {
          const found = rows.find((r) => r.trip_id === v.tripId);
          v.routeId = found?.route_id || getCachedRouteId(v.tripId) || "";
        }
      }
    } catch (e: any) {
      console.error("Trip lookup error:", e.message);
    }
  } else {
    for (const v of vehicles) {
      if (!v.routeId && v.tripId) {
        v.routeId = getCachedRouteId(v.tripId) || "";
      }
    }
  }

  const result = { vehicles, timestamp: feedObj.header?.timestamp };
  cache = { data: result, fetchedAt: Date.now() };
  return c.json(result);
});
