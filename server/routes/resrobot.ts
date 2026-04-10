import { Hono } from "hono";

const RESROBOT_TRIP_URL = "https://api.resrobot.se/v2.1/trip";
const CACHE_TTL_MS = 60_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

let cache: {
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  fetchedAt: number;
} | null = null;

export const resrobotRoute = new Hono();

resrobotRoute.post("/trip", async (c) => {
  const apiKey = process.env.RESROBOT_API_KEY;
  if (!apiKey) {
    return c.json({ error: "ResRobot API key not configured" }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const originLat = Number(body.originLat);
  const originLon = Number(body.originLon);
  const destLat = Number(body.destLat);
  const destLon = Number(body.destLon);
  const walkSpeedKmh = clamp(Number(body.walkSpeedKmh ?? 5), 3.3, 10);
  const walkTimePercent = clamp(Math.round((5 / walkSpeedKmh) * 100), 50, 150);
  const lang = body.lang === "en" || body.lang === "de" || body.lang === "sv" ? body.lang : "sv";

  if ([originLat, originLon, destLat, destLon].some(Number.isNaN)) {
    return c.json({ error: "originLat, originLon, destLat, destLon are required" }, 400);
  }

  const numF = clamp(Number(body.numF ?? 3), 1, 6);

  const cacheKey = `${originLat.toFixed(4)},${originLon.toFixed(4)},${destLat.toFixed(4)},${destLon.toFixed(4)},${numF},${lang},${walkTimePercent}`;
  if (cache && cache.key === cacheKey && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return c.json(cache.data);
  }

  const url = new URL(RESROBOT_TRIP_URL);
  url.searchParams.set("accessId", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", lang);
  url.searchParams.set("originCoordLat", String(clamp(originLat, -90, 90)));
  url.searchParams.set("originCoordLong", String(clamp(originLon, -180, 180)));
  url.searchParams.set("destCoordLat", String(clamp(destLat, -90, 90)));
  url.searchParams.set("destCoordLong", String(clamp(destLon, -180, 180)));
  url.searchParams.set("numF", String(numF));
  url.searchParams.set("passlist", "0");
  url.searchParams.set("originWalk", `1,0,2000,${walkTimePercent}`);
  url.searchParams.set("destWalk", `1,0,2000,${walkTimePercent}`);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error("ResRobot error:", response.status, errText);
    return c.json({ error: `ResRobot API error: ${response.status}` }, 502);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = (await response.json()) as any;
  const trips = Array.isArray(payload.Trip) ? payload.Trip : [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const simplified = trips.map((trip: any) => {
    const legs = Array.isArray(trip.LegList?.Leg)
      ? trip.LegList.Leg
      : trip.LegList?.Leg
        ? [trip.LegList.Leg]
        : [];

    return {
      duration: trip.duration ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      legs: legs.map((leg: any) => {
        const product = Array.isArray(leg.Product) ? leg.Product[0] : leg.Product;
        return {
          type: leg.type,
          name: leg.name ?? null,
          direction: leg.direction ?? null,
          category: product?.catOutS ?? leg.category ?? null,
          line: product?.line ?? product?.displayNumber ?? product?.num ?? null,
          operator: product?.operator ?? null,
          origin: {
            name: leg.Origin?.name ?? null,
            time: leg.Origin?.time ?? null,
            date: leg.Origin?.date ?? null,
            lat: leg.Origin?.lat != null ? Number(leg.Origin.lat) : null,
            lon: leg.Origin?.lon != null ? Number(leg.Origin.lon) : null,
            extId: leg.Origin?.extId ?? null,
          },
          destination: {
            name: leg.Destination?.name ?? null,
            time: leg.Destination?.time ?? null,
            date: leg.Destination?.date ?? null,
            lat: leg.Destination?.lat != null ? Number(leg.Destination.lat) : null,
            lon: leg.Destination?.lon != null ? Number(leg.Destination.lon) : null,
            extId: leg.Destination?.extId ?? null,
          },
          dist: leg.dist != null ? Number(leg.dist) : null,
        };
      }),
    };
  });

  const result = { trips: simplified };
  cache = { key: cacheKey, data: result, fetchedAt: Date.now() };
  return c.json(result);
});
