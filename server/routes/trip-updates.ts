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
  optional TripUpdate trip_update = 3;
}
message TripUpdate {
  optional TripDescriptor trip = 1;
  repeated StopTimeUpdate stop_time_update = 2;
  optional uint64 timestamp = 4;
}
message TripDescriptor {
  optional string trip_id = 1;
  optional string start_time = 2;
  optional string start_date = 3;
  optional string route_id = 5;
  optional uint32 direction_id = 6;
  optional ScheduleRelationship schedule_relationship = 4;
  enum ScheduleRelationship {
    SCHEDULED = 0;
    ADDED = 1;
    UNSCHEDULED = 2;
    CANCELED = 3;
  }
}
message StopTimeUpdate {
  optional uint32 stop_sequence = 1;
  optional string stop_id = 4;
  optional StopTimeEvent arrival = 2;
  optional StopTimeEvent departure = 3;
  optional ScheduleRelationship schedule_relationship = 5;
  enum ScheduleRelationship {
    SCHEDULED = 0;
    SKIPPED = 1;
    NO_DATA = 2;
  }
}
message StopTimeEvent {
  optional int32 delay = 1;
  optional int64 time = 2;
}
`;

let cachedRoot: protobuf.Root | null = null;
function getRoot() {
  if (!cachedRoot) {
    cachedRoot = protobuf.parse(PROTO_DEF).root;
  }
  return cachedRoot;
}

interface TripDelay {
  tripId: string;
  routeId: string;
  directionId: number;
  canceled: boolean;
  delay: number | null;
  stopUpdates: {
    stopId: string;
    stopSequence: number;
    arrivalDelay: number | null;
    departureDelay: number | null;
  }[];
}

// In-memory cache: refresh at most every 15 seconds
let cache: { data: TripDelay[]; timestamp: number; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 15_000;

const TRIP_ROUTE_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const tripRouteCache = new Map<string, { routeId: string; expiresAt: number }>();

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

const SCHEDULE_RELATIONSHIP: Record<number, string> = {
  0: "SCHEDULED",
  1: "ADDED",
  2: "UNSCHEDULED",
  3: "CANCELED",
};

export const tripUpdatesRoute = new Hono();

tripUpdatesRoute.post("/", async (c) => {
  const now = Date.now();

  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return c.json({ tripUpdates: cache.data, timestamp: cache.timestamp });
  }

  const apiKey = process.env.TRAFIKLAB_SWEDEN3_RT_KEY;
  if (!apiKey) {
    return c.json({ error: "API key not configured" }, 500);
  }

  const url = `https://opendata.samtrafiken.se/gtfs-rt-sweden/ul/TripUpdatesSweden.pb?key=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) {
    return c.json({ error: `Trafiklab error: ${response.status}` }, response.status as 400);
  }

  const buffer = await response.arrayBuffer();
  const root = getRoot();
  const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
  const feed = FeedMessage.decode(new Uint8Array(buffer));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feedObj = FeedMessage.toObject(feed, { longs: Number, defaults: true }) as Record<string, any>;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const tripUpdates: TripDelay[] = ((feedObj.entity || []) as any[])
    .filter((e: any) => e.tripUpdate?.trip?.tripId)
    .map((e: any) => {
      const tu = e.tripUpdate;
      const trip = tu.trip;
      const canceled = SCHEDULE_RELATIONSHIP[trip.scheduleRelationship] === "CANCELED";

      const stopUpdates = ((tu.stopTimeUpdate || []) as any[]).map((stu: any) => ({
        stopId: stu.stopId || "",
        stopSequence: stu.stopSequence || 0,
        arrivalDelay: stu.arrival?.delay ?? null,
        departureDelay: stu.departure?.delay ?? null,
      }));

      // Overall trip delay = last reported stop update delay
      const lastUpdate = stopUpdates.length > 0 ? stopUpdates[stopUpdates.length - 1] : null;
      const delay = lastUpdate?.arrivalDelay ?? lastUpdate?.departureDelay ?? null;

      return {
        tripId: trip.tripId,
        routeId: trip.routeId || "",
        directionId: trip.directionId || 0,
        canceled,
        delay,
        stopUpdates,
      };
    });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Resolve routeId from static GTFS — same approach as vehicles.ts so the
  // client receives consistent route IDs across both endpoints.
  const tripIdsToResolve = [
    ...new Set(
      tripUpdates
        .filter((tu) => tu.tripId && !getCachedRouteId(tu.tripId))
        .map((tu) => tu.tripId)
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

      for (const tu of tripUpdates) {
        if (tu.tripId) {
          const found = rows.find((r) => r.trip_id === tu.tripId);
          const resolvedRouteId = found?.route_id || getCachedRouteId(tu.tripId);
          if (resolvedRouteId) {
            tu.routeId = resolvedRouteId;
          }
        }
      }
    } catch (e: unknown) {
      console.error("Trip-updates route lookup error:", e instanceof Error ? e.message : e);
    }
  } else {
    for (const tu of tripUpdates) {
      if (tu.tripId) {
        const cached = getCachedRouteId(tu.tripId);
        if (cached) {
          tu.routeId = cached;
        }
      }
    }
  }

  cache = {
    data: tripUpdates,
    timestamp: feedObj.header?.timestamp || 0,
    fetchedAt: now,
  };

  return c.json({ tripUpdates, timestamp: cache.timestamp });
});
