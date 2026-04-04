import { Hono } from "hono";
import protobuf from "protobufjs";

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
  optional Alert alert = 6;
}
message Alert {
  repeated TimeRange active_period = 1;
  repeated EntitySelector informed_entity = 5;
  optional TranslatedString header_text = 10;
  optional TranslatedString description_text = 11;
  optional Cause cause = 6;
  optional Effect effect = 7;
  optional TranslatedString url = 8;

  enum Cause {
    UNKNOWN_CAUSE = 1;
    OTHER_CAUSE = 2;
    TECHNICAL_PROBLEM = 3;
    STRIKE = 4;
    DEMONSTRATION = 5;
    ACCIDENT = 6;
    HOLIDAY = 7;
    WEATHER = 8;
    MAINTENANCE = 9;
    CONSTRUCTION = 10;
    POLICE_ACTIVITY = 11;
    MEDICAL_EMERGENCY = 12;
  }
  enum Effect {
    NO_SERVICE = 1;
    REDUCED_SERVICE = 2;
    SIGNIFICANT_DELAYS = 3;
    DETOUR = 4;
    ADDITIONAL_SERVICE = 5;
    MODIFIED_SERVICE = 6;
    OTHER_EFFECT = 7;
    UNKNOWN_EFFECT = 8;
    STOP_MOVED = 9;
  }
}
message TimeRange {
  optional uint64 start = 1;
  optional uint64 end = 2;
}
message EntitySelector {
  optional string agency_id = 1;
  optional string route_id = 2;
  optional TripDescriptor trip = 3;
  optional string stop_id = 4;
  optional uint32 route_type = 5;
}
message TripDescriptor {
  optional string trip_id = 1;
  optional string route_id = 5;
}
message TranslatedString {
  repeated Translation translation = 1;
  message Translation {
    required string text = 1;
    optional string language = 2;
  }
}
`;

let cachedRoot: protobuf.Root | null = null;
function getRoot() {
  if (!cachedRoot) {
    cachedRoot = protobuf.parse(PROTO_DEF).root;
  }
  return cachedRoot;
}

const CAUSE_MAP: Record<number, string> = {
  1: "UNKNOWN_CAUSE", 2: "OTHER_CAUSE", 3: "TECHNICAL_PROBLEM",
  4: "STRIKE", 5: "DEMONSTRATION", 6: "ACCIDENT", 7: "HOLIDAY",
  8: "WEATHER", 9: "MAINTENANCE", 10: "CONSTRUCTION",
  11: "POLICE_ACTIVITY", 12: "MEDICAL_EMERGENCY",
};

const EFFECT_MAP: Record<number, string> = {
  1: "NO_SERVICE", 2: "REDUCED_SERVICE", 3: "SIGNIFICANT_DELAYS",
  4: "DETOUR", 5: "ADDITIONAL_SERVICE", 6: "MODIFIED_SERVICE",
  7: "OTHER_EFFECT", 8: "UNKNOWN_EFFECT", 9: "STOP_MOVED",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickTranslation(ts: any, preferLang: string): string {
  if (!ts?.translation?.length) return "";
  const translations = ts.translation as { text: string; language?: string }[];
  const preferred = translations.find((t) => t.language === preferLang);
  if (preferred) return preferred.text;
  const en = translations.find((t) => t.language === "en");
  if (en) return en.text;
  return translations[0].text;
}

export interface ServiceAlert {
  id: string;
  header: string;
  description: string;
  url: string;
  cause: string;
  effect: string;
  routeIds: string[];
  stopIds: string[];
  tripIds: string[];
  activePeriods: { start: number; end: number }[];
}

// In-memory cache: refresh at most every 60 seconds
let cache: { data: ServiceAlert[]; timestamp: number; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export const serviceAlertsRoute = new Hono();

serviceAlertsRoute.post("/", async (c) => {
  const now = Date.now();
  const body = await c.req.json().catch(() => ({}));
  const lang = (body as Record<string, unknown>)?.language === "sv" ? "sv" : "en";

  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    // Re-pick translations for requested language
    return c.json({ alerts: cache.data, timestamp: cache.timestamp });
  }

  const apiKey = process.env.TRAFIKLAB_SWEDEN3_RT_KEY;
  if (!apiKey) {
    return c.json({ error: "API key not configured" }, 500);
  }

  const url = `https://opendata.samtrafiken.se/gtfs-rt-sweden/ul/ServiceAlertsSweden.pb?key=${apiKey}`;
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

  const nowSec = Math.floor(now / 1000);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const alerts: ServiceAlert[] = ((feedObj.entity || []) as any[])
    .filter((e: any) => e.alert)
    .map((e: any) => {
      const a = e.alert;
      const activePeriods = ((a.activePeriod || []) as any[]).map((p: any) => ({
        start: p.start || 0,
        end: p.end || 0,
      }));

      const routeIds: string[] = [];
      const stopIds: string[] = [];
      const tripIds: string[] = [];
      for (const ie of (a.informedEntity || []) as any[]) {
        if (ie.routeId) routeIds.push(ie.routeId);
        if (ie.stopId) stopIds.push(ie.stopId);
        if (ie.trip?.tripId) tripIds.push(ie.trip.tripId);
      }

      return {
        id: e.id,
        header: pickTranslation(a.headerText, lang),
        description: pickTranslation(a.descriptionText, lang),
        url: pickTranslation(a.url, lang),
        cause: CAUSE_MAP[a.cause] || "UNKNOWN_CAUSE",
        effect: EFFECT_MAP[a.effect] || "UNKNOWN_EFFECT",
        routeIds,
        stopIds,
        tripIds,
        activePeriods,
      };
    })
    // Filter to currently active alerts
    .filter((alert) => {
      if (alert.activePeriods.length === 0) return true;
      return alert.activePeriods.some(
        (p) => (p.start === 0 || p.start <= nowSec) && (p.end === 0 || p.end >= nowSec)
      );
    });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  cache = {
    data: alerts,
    timestamp: feedObj.header?.timestamp || 0,
    fetchedAt: now,
  };

  return c.json({ alerts, timestamp: cache.timestamp });
});
