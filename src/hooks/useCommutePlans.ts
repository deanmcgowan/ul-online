import { useEffect, useMemo, useRef, useState } from "react";
import { fetchResRobotTrip, type ResRobotTrip, type ResRobotLeg } from "@/lib/api";
import type { TransitStop } from "@/components/BusMap";
import type { RoadSituation } from "@/hooks/useRoadSituations";
import type { SavedPlace } from "@/lib/savedPlaces";
import type { SupportedLanguage } from "@/lib/i18n";
import { haversineDistanceMeters } from "@/lib/transitMatching";

const ACTIVE_PLACE_RADIUS_METERS = 900;
const MAX_COMMUTE_CARDS = 3;

type CommuteGuidance = "leave-now" | "leave-soon" | "wait";
type CommuteConfidence = "high" | "medium" | "low";

export interface CommuteTrafficImpact {
  id: string;
  label: string;
  messageType: string;
  distanceMeters: number;
  webLink?: string;
}

export interface CommuteLeg {
  type: "JNY" | "WALK" | "TRSF";
  line: string | null;
  name: string | null;
  direction: string | null;
  category: string | null;
  originName: string;
  originTime: string | null;
  destinationName: string;
  destinationTime: string | null;
  distMeters: number | null;
}

export interface CommuteOption {
  lineNumber: string;
  tripId: string;
  vehicleId: string;
  originStop: TransitStop;
  destinationStop: TransitStop;
  originStopDistanceMeters: number;
  destinationStopDistanceMeters: number;
  walkDistanceMeters: number;
  walkSeconds: number;
  destinationWalkDistanceMeters: number;
  destinationWalkSeconds: number;
  vehicleEtaSeconds: number;
  slackSeconds: number;
  guidance: CommuteGuidance;
  confidence: CommuteConfidence;
  score: number;
  stopCount: number;
  trafficImpact: CommuteTrafficImpact | null;
  legs: CommuteLeg[];
  departureTime: string | null;
  arrivalTime: string | null;
  durationMinutes: number | null;
  transfers: number;
}

export interface CommutePlan {
  id: string;
  origin: SavedPlace;
  destination: SavedPlace;
  activeOrigin: boolean;
  bestOption: CommuteOption | null;
  fallbackOption: CommuteOption | null;
  note: string | null;
}

function buildJourneyPairs(savedPlaces: SavedPlace[], userLocation: [number, number] | null) {
  const pairs: Array<{ origin: SavedPlace; destination: SavedPlace; activeOrigin: boolean }> = [];

  if (userLocation) {
    const currentLocationPlace: SavedPlace = {
      id: "__current_location__",
      kind: "other",
      label: "",
      displayName: "",
      lat: userLocation[1],
      lon: userLocation[0],
      createdAt: 0,
      updatedAt: 0,
    };

    const nearestPlace = savedPlaces
      .map((place) => ({
        place,
        distanceMeters: haversineDistanceMeters(userLocation[1], userLocation[0], place.lat, place.lon),
      }))
      .sort((left, right) => left.distanceMeters - right.distanceMeters)[0];

    if (nearestPlace && nearestPlace.distanceMeters <= ACTIVE_PLACE_RADIUS_METERS) {
      for (const destination of savedPlaces) {
        if (destination.id === nearestPlace.place.id) continue;
        pairs.push({ origin: nearestPlace.place, destination, activeOrigin: true });
      }
    } else {
      for (const place of savedPlaces) {
        pairs.push({ origin: currentLocationPlace, destination: place, activeOrigin: true });
      }
    }
  }

  if (savedPlaces.length >= 2 && pairs.length < MAX_COMMUTE_CARDS) {
    const home = savedPlaces.find((place) => place.kind === "home") ?? null;
    const work = savedPlaces.find((place) => place.kind === "work") ?? null;

    if (home && work) {
      const exists1 = pairs.some((p) => p.origin.id === home.id && p.destination.id === work.id);
      if (!exists1) pairs.push({ origin: home, destination: work, activeOrigin: false });
      const exists2 = pairs.some((p) => p.origin.id === work.id && p.destination.id === home.id);
      if (!exists2) pairs.push({ origin: work, destination: home, activeOrigin: false });
    }

    for (const origin of savedPlaces) {
      for (const destination of savedPlaces) {
        if (origin.id === destination.id) continue;
        const exists = pairs.some((p) => p.origin.id === origin.id && p.destination.id === destination.id);
        if (!exists) pairs.push({ origin, destination, activeOrigin: false });
      }
    }
  }

  return pairs.slice(0, MAX_COMMUTE_CARDS);
}

function getOriginCoords(origin: SavedPlace, userLocation: [number, number] | null) {
  if (origin.id === "__current_location__" && userLocation) {
    return { lat: userLocation[1], lon: userLocation[0] };
  }
  if (userLocation) {
    const dist = haversineDistanceMeters(userLocation[1], userLocation[0], origin.lat, origin.lon);
    if (dist <= ACTIVE_PLACE_RADIUS_METERS) {
      return { lat: userLocation[1], lon: userLocation[0] };
    }
  }
  return { lat: origin.lat, lon: origin.lon };
}

function parseTimeToSeconds(time: string | null) {
  if (!time) return null;
  const parts = time.split(":");
  if (parts.length < 2) return null;
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + (Number(parts[2] ?? 0));
}

function parseDurationMinutes(duration: string | null) {
  if (!duration) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?/.exec(duration);
  if (!match) return null;
  return (Number(match[1] ?? 0)) * 60 + Number(match[2] ?? 0);
}

function makeSyntheticStop(name: string | null, lat: number | null, lon: number | null, extId: string | null): TransitStop {
  return {
    stop_id: extId ?? `synth_${(name ?? "unknown").replace(/\s+/g, "_")}_${lat}_${lon}`,
    stop_name: name ?? "Unknown stop",
    stop_lat: lat ?? 0,
    stop_lon: lon ?? 0,
  };
}

const TRAFFIC_TYPE_TRANSLATIONS_EN: Record<string, string> = {
  "Vägarbete": "Roadwork",
  "Beläggningsarbete": "Road surfacing",
  "Trafikstörning": "Traffic disruption",
  "Olycka": "Accident",
  "Risk för kö": "Risk of queue",
  "Kö": "Queue",
  "Fordonshaveri": "Vehicle breakdown",
  "Väder": "Weather",
  "Evenemang": "Event",
  "Övrigt": "Other",
};

function localizeTrafficType(messageType: string, language: SupportedLanguage) {
  if (language === "sv-SE") return messageType;
  return TRAFFIC_TYPE_TRANSLATIONS_EN[messageType] ?? messageType;
}

// ── Google walking distance (server-side proxy with client cache) ────────────

interface WalkDistResult { distanceMeters: number; durationSeconds: number }
const walkDistCache = new Map<string, WalkDistResult>();

async function fetchGoogleWalkDist(
  fromLat: number, fromLon: number,
  toLat: number, toLon: number,
): Promise<WalkDistResult | null> {
  const key = `${fromLat.toFixed(3)},${fromLon.toFixed(3)},${toLat.toFixed(3)},${toLon.toFixed(3)}`;
  const cached = walkDistCache.get(key);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({
      fromLat: String(fromLat), fromLon: String(fromLon),
      toLat: String(toLat), toLon: String(toLon),
    });
    const resp = await fetch(`/api/walk-distance?${params}`);
    if (!resp.ok) return null;
    const data = await resp.json() as WalkDistResult;
    walkDistCache.set(key, data);
    return data;
  } catch {
    return null;
  }
}

function convertTrip(
  trip: ResRobotTrip,
  originCoords: { lat: number; lon: number },
  destCoords: { lat: number; lon: number },
  walkSpeed: number,
  bufferMinutes: number,
  originWalkOverride: WalkDistResult | null = null,
  destWalkOverride: WalkDistResult | null = null,
): CommuteOption | null {
  const transitLegs = trip.legs.filter((leg) => leg.type === "JNY");
  if (transitLegs.length === 0) return null;

  const firstTransit = transitLegs[0];
  const lastTransit = transitLegs[transitLegs.length - 1];

  const originStop = makeSyntheticStop(
    firstTransit.origin.name,
    firstTransit.origin.lat,
    firstTransit.origin.lon,
    firstTransit.origin.extId,
  );
  const destinationStop = makeSyntheticStop(
    lastTransit.destination.name,
    lastTransit.destination.lat,
    lastTransit.destination.lon,
    lastTransit.destination.extId,
  );

  const originStopDistanceMeters = Math.round(
    haversineDistanceMeters(originCoords.lat, originCoords.lon, originStop.stop_lat, originStop.stop_lon),
  );
  const destinationStopDistanceMeters = Math.round(
    haversineDistanceMeters(destCoords.lat, destCoords.lon, destinationStop.stop_lat, destinationStop.stop_lon),
  );

  // Walk time to first transit stop
  const firstLeg = trip.legs[0];
  let walkSeconds = 0;
  let walkDistanceMeters = 0;
  if (firstLeg.type === "WALK" && firstLeg.dist) {
    walkDistanceMeters = firstLeg.dist;
    walkSeconds = walkDistanceMeters / Math.max(walkSpeed / 3.6, 0.5);
  } else if (originWalkOverride) {
    walkDistanceMeters = originWalkOverride.distanceMeters;
    walkSeconds = originWalkOverride.durationSeconds;
  } else {
    walkDistanceMeters = originStopDistanceMeters;
    walkSeconds = walkDistanceMeters / Math.max(walkSpeed / 3.6, 0.5);
  }

  // Walk from last transit stop to destination
  const lastLeg = trip.legs[trip.legs.length - 1];
  let destinationWalkDistanceMeters = 0;
  let destinationWalkSeconds = 0;
  if (lastLeg.type === "WALK" && lastLeg.dist) {
    destinationWalkDistanceMeters = lastLeg.dist;
    destinationWalkSeconds = destinationWalkDistanceMeters / Math.max(walkSpeed / 3.6, 0.5);
  } else if (destWalkOverride) {
    destinationWalkDistanceMeters = destWalkOverride.distanceMeters;
    destinationWalkSeconds = destWalkOverride.durationSeconds;
  } else {
    destinationWalkDistanceMeters = destinationStopDistanceMeters;
    destinationWalkSeconds = destinationWalkDistanceMeters / Math.max(walkSpeed / 3.6, 0.5);
  }

  // Timing: seconds from now until first transit departs
  const now = new Date();
  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const departureSeconds = parseTimeToSeconds(firstTransit.origin.time);
  let vehicleEtaSeconds = 0;
  if (departureSeconds !== null) {
    vehicleEtaSeconds = departureSeconds - nowSeconds;
    if (vehicleEtaSeconds < -3600) vehicleEtaSeconds += 86400; // next day wrap
  }

  const slackSeconds = Math.round(vehicleEtaSeconds - walkSeconds - bufferMinutes * 60);
  const durationMinutes = parseDurationMinutes(trip.duration);
  const transfers = Math.max(0, transitLegs.length - 1);

  const guidance: CommuteGuidance = slackSeconds <= 0 ? "leave-now" : slackSeconds <= 120 ? "leave-soon" : "wait";
  const confidence: CommuteConfidence = slackSeconds >= 300 ? "high" : slackSeconds >= 120 ? "medium" : "low";
  const score = vehicleEtaSeconds + destinationWalkSeconds * 0.4 + Math.max(0, -slackSeconds) * 3 + transfers * 60;

  const lineNumber = firstTransit.line ?? firstTransit.name ?? "?";

  const legs: CommuteLeg[] = trip.legs.map((leg) => ({
    type: (leg.type === "JNY" || leg.type === "WALK" || leg.type === "TRSF" ? leg.type : "WALK") as CommuteLeg["type"],
    line: leg.line,
    name: leg.name,
    direction: leg.direction,
    category: leg.category,
    originName: leg.origin.name ?? "?",
    originTime: leg.origin.time?.slice(0, 5) ?? null,
    destinationName: leg.destination.name ?? "?",
    destinationTime: leg.destination.time?.slice(0, 5) ?? null,
    distMeters: leg.dist,
  }));

  return {
    lineNumber,
    tripId: "",
    vehicleId: "",
    originStop,
    destinationStop,
    originStopDistanceMeters,
    destinationStopDistanceMeters,
    walkDistanceMeters: Math.round(walkDistanceMeters),
    walkSeconds: Math.round(walkSeconds),
    destinationWalkDistanceMeters: Math.round(destinationWalkDistanceMeters),
    destinationWalkSeconds: Math.round(destinationWalkSeconds),
    vehicleEtaSeconds: Math.round(Math.max(0, vehicleEtaSeconds)),
    slackSeconds: Math.round(slackSeconds),
    guidance,
    confidence,
    score,
    stopCount: 0,
    trafficImpact: null,
    legs,
    departureTime: firstTransit.origin.time?.slice(0, 5) ?? null,
    arrivalTime: lastTransit.destination.time?.slice(0, 5) ?? null,
    durationMinutes,
    transfers,
  };
}

function getTrafficImpactForOption(
  option: CommuteOption,
  situations: RoadSituation[],
  language: SupportedLanguage,
): CommuteTrafficImpact | null {
  if (situations.length === 0) return null;

  const midpoint = {
    lat: (option.originStop.stop_lat + option.destinationStop.stop_lat) / 2,
    lon: (option.originStop.stop_lon + option.destinationStop.stop_lon) / 2,
  };

  const ranked = situations
    .map((situation) => {
      const originDist = haversineDistanceMeters(option.originStop.stop_lat, option.originStop.stop_lon, situation.lat, situation.lon);
      const destDist = haversineDistanceMeters(option.destinationStop.stop_lat, option.destinationStop.stop_lon, situation.lat, situation.lon);
      const midDist = haversineDistanceMeters(midpoint.lat, midpoint.lon, situation.lat, situation.lon);
      return { situation, distanceMeters: Math.round(Math.min(originDist, destDist, midDist)) };
    })
    .filter((e) => e.distanceMeters <= 2500)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const closest = ranked[0];
  if (!closest) return null;

  return {
    id: closest.situation.id,
    label: localizeTrafficType(closest.situation.messageType, language),
    messageType: closest.situation.messageType,
    distanceMeters: closest.distanceMeters,
    webLink: closest.situation.webLink || undefined,
  };
}

export function getTrafficQueryForPlan(plan: CommutePlan | null) {
  if (!plan?.bestOption) return null;

  const { originStop, destinationStop } = plan.bestOption;
  const midpointLat = (originStop.stop_lat + destinationStop.stop_lat) / 2;
  const midpointLon = (originStop.stop_lon + destinationStop.stop_lon) / 2;
  const journeyDistance = haversineDistanceMeters(
    originStop.stop_lat,
    originStop.stop_lon,
    destinationStop.stop_lat,
    destinationStop.stop_lon,
  );

  return {
    lat: Number(midpointLat.toFixed(6)),
    lon: Number(midpointLon.toFixed(6)),
    radiusMeters: Math.min(10000, Math.max(2500, Math.round(journeyDistance * 0.8))),
    limit: 6,
  };
}

const REFRESH_MS = 90_000;

export function useCommutePlans({
  savedPlaces,
  userLocation,
  walkSpeed,
  bufferMinutes,
  language,
  roadSituations = [],
}: {
  savedPlaces: SavedPlace[];
  userLocation: [number, number] | null;
  walkSpeed: number;
  bufferMinutes: number;
  language: SupportedLanguage;
  roadSituations?: RoadSituation[];
}) {
  // rawPlans: trip data only, no traffic impact (independent of roadSituations)
  const [rawPlans, setRawPlans] = useState<CommutePlan[]>([]);
  const [loading, setLoading] = useState(false);

  // Keep a ref for roadSituations so the fetch effect can read the latest value
  // without roadSituations being a dependency that triggers cancellations.
  const roadSituationsRef = useRef(roadSituations);
  useEffect(() => { roadSituationsRef.current = roadSituations; }, [roadSituations]);

  const journeyPairs = useMemo(
    () => buildJourneyPairs(savedPlaces, userLocation),
    [savedPlaces, userLocation],
  );

  useEffect(() => {
    if (journeyPairs.length === 0) {
      setRawPlans([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function buildPlan(pair: (typeof journeyPairs)[number]): Promise<CommutePlan> {
      const originCoords = getOriginCoords(pair.origin, userLocation);
      const destCoords = { lat: pair.destination.lat, lon: pair.destination.lon };

      const { data, error } = await fetchResRobotTrip({
        originLat: originCoords.lat,
        originLon: originCoords.lon,
        destLat: destCoords.lat,
        destLon: destCoords.lon,
        numF: 3,
        lang: language === "sv-SE" ? "sv" : "en",
        walkSpeedKmh: walkSpeed,
      });

      if (error || !data?.trips?.length) {
        return {
          id: `${pair.origin.id}:${pair.destination.id}`,
          origin: pair.origin,
          destination: pair.destination,
          activeOrigin: pair.activeOrigin,
          bestOption: null,
          fallbackOption: null,
          note: error ? "Could not reach the journey planner right now." : "No upcoming journey found for this route.",
        };
      }

      const options = await Promise.all(
        data.trips.map(async (trip) => {
          const transitLegs = trip.legs.filter((leg) => leg.type === "JNY");
          const firstTransit = transitLegs[0];
          const lastTransit = transitLegs[transitLegs.length - 1];
          const firstLeg = trip.legs[0];
          const lastLeg = trip.legs[trip.legs.length - 1];

          // Only fetch Google walk distance when ResRobot has no walk leg with distance
          const [originWalkOverride, destWalkOverride] = await Promise.all([
            (firstLeg.type === "WALK" && firstLeg.dist)
              ? Promise.resolve(null)
              : fetchGoogleWalkDist(
                  originCoords.lat, originCoords.lon,
                  firstTransit?.origin.lat ?? originCoords.lat,
                  firstTransit?.origin.lon ?? originCoords.lon,
                ),
            (lastLeg.type === "WALK" && lastLeg.dist)
              ? Promise.resolve(null)
              : fetchGoogleWalkDist(
                  lastTransit?.destination.lat ?? destCoords.lat,
                  lastTransit?.destination.lon ?? destCoords.lon,
                  destCoords.lat, destCoords.lon,
                ),
          ]);

          return convertTrip(trip, originCoords, destCoords, walkSpeed, bufferMinutes, originWalkOverride, destWalkOverride);
        })
      );
      const sortedOptions = options
        .filter((opt): opt is CommuteOption => opt !== null)
        .sort((a, b) => a.score - b.score);

      return {
        id: `${pair.origin.id}:${pair.destination.id}`,
        origin: pair.origin,
        destination: pair.destination,
        activeOrigin: pair.activeOrigin,
        bestOption: sortedOptions[0] ?? null,
        fallbackOption: sortedOptions[1] ?? null,
        note: sortedOptions.length === 0 ? "No suitable departure found right now." : null,
      };
    }

    async function loadPlans() {
      if (cancelled) return;
      setLoading(true);
      try {
        const nextPlans = await Promise.all(journeyPairs.map(buildPlan));
        if (!cancelled) setRawPlans(nextPlans);
      } catch (err) {
        console.warn("Commute planning failed", err);
        if (!cancelled) {
          setRawPlans(
            journeyPairs.map((pair) => ({
              id: `${pair.origin.id}:${pair.destination.id}`,
              origin: pair.origin,
              destination: pair.destination,
              activeOrigin: pair.activeOrigin,
              bestOption: null,
              fallbackOption: null,
              note: "Commute planning is temporarily unavailable.",
            })),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPlans();
    const timer = setInterval(loadPlans, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [bufferMinutes, journeyPairs, language, walkSpeed]); // intentionally excludes roadSituations and userLocation

  // Apply traffic impact as a derived computation — no API calls, no cancellation risk.
  const plans = useMemo<CommutePlan[]>(() => {
    return rawPlans.map((plan) => ({
      ...plan,
      bestOption: plan.bestOption
        ? { ...plan.bestOption, trafficImpact: getTrafficImpactForOption(plan.bestOption, roadSituationsRef.current, language) }
        : null,
      fallbackOption: plan.fallbackOption
        ? { ...plan.fallbackOption, trafficImpact: getTrafficImpactForOption(plan.fallbackOption, roadSituationsRef.current, language) }
        : null,
    }));
  }, [rawPlans, roadSituations, language]); // eslint-disable-line react-hooks/exhaustive-deps

  return { plans, loading };
}
