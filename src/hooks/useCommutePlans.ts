import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TransitStop, Vehicle } from "@/components/BusMap";
import { bearingTowardStop } from "@/lib/busIcon";
import type { RoadSituation } from "@/hooks/useRoadSituations";
import type { SavedPlace } from "@/lib/savedPlaces";
import { haversineDistanceMeters, pickBestUpcomingStopMatch, type StopTimeMatch } from "@/lib/transitMatching";

const PREFERRED_STOP_DISTANCE_METERS = 850;
const MAX_STOPS_PER_PLACE = 6;
const ACTIVE_PLACE_RADIUS_METERS = 900;
const MAX_COMMUTE_CARDS = 3;
const MAX_ROUTING_LOOKUPS = 4;

type CommuteGuidance = "leave-now" | "leave-soon" | "wait";
type CommuteConfidence = "high" | "medium" | "low";

interface NearbyTransitStop {
  stop: TransitStop;
  distanceMeters: number;
}

export interface CommuteTrafficImpact {
  id: string;
  label: string;
  messageType: string;
  distanceMeters: number;
  webLink?: string;
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

interface RawCommuteOption {
  vehicle: Vehicle;
  lineNumber: string;
  originStop: TransitStop;
  destinationStop: TransitStop;
  originStopDistanceMeters: number;
  destinationStopDistanceMeters: number;
  stopCount: number;
  approximateEtaSeconds: number;
  approximateScore: number;
  isTowardOrigin: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getNearbyStops(lat: number, lon: number, stops: TransitStop[], maxWalkDistanceMeters: number): NearbyTransitStop[] {
  const rankedStops = stops
    .map((stop) => ({
      stop,
      distanceMeters: Math.round(haversineDistanceMeters(lat, lon, stop.stop_lat, stop.stop_lon)),
    }))
    .sort((left, right) => left.distanceMeters - right.distanceMeters);

  const preferredStops = rankedStops
    .filter((entry) => entry.distanceMeters <= Math.min(PREFERRED_STOP_DISTANCE_METERS, maxWalkDistanceMeters))
    .slice(0, MAX_STOPS_PER_PLACE);

  if (preferredStops.length >= 2) {
    return preferredStops;
  }

  return rankedStops
    .filter((entry) => entry.distanceMeters <= maxWalkDistanceMeters)
    .slice(0, MAX_STOPS_PER_PLACE);
}

function getApproximateVehicleEta(vehicle: Vehicle, targetStop: TransitStop, stopCount: number, isTowardOrigin: boolean) {
  const directDistance = haversineDistanceMeters(
    vehicle.lat,
    vehicle.lon,
    targetStop.stop_lat,
    targetStop.stop_lon,
  );
  const assumedSpeed = Math.max(vehicle.speed || 0, 4);
  const driveSeconds = directDistance / assumedSpeed;
  const dwellPenaltySeconds = Math.max(0, stopCount - 1) * 25;
  const headingPenaltySeconds = isTowardOrigin ? 0 : 90;

  return Math.round(driveSeconds + dwellPenaltySeconds + headingPenaltySeconds);
}

async function getRoadDurationSeconds(vehicle: Vehicle, targetStop: TransitStop, signal?: AbortSignal) {
  const url = new URL(
    `https://router.project-osrm.org/route/v1/driving/${vehicle.lon},${vehicle.lat};${targetStop.stop_lon},${targetStop.stop_lat}`,
  );
  url.searchParams.set("overview", "false");
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("steps", "false");

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Routing service returned ${response.status}`);
  }

  const data = (await response.json()) as { routes?: Array<{ duration?: number }> };
  return data.routes?.[0]?.duration ?? null;
}

function getCommuteGuidance(slackSeconds: number): CommuteGuidance {
  if (slackSeconds <= 0) {
    return "leave-now";
  }

  if (slackSeconds <= 120) {
    return "leave-soon";
  }

  return "wait";
}

function getCommuteConfidence(slackSeconds: number): CommuteConfidence {
  if (slackSeconds >= 5 * 60) {
    return "high";
  }

  if (slackSeconds >= 2 * 60) {
    return "medium";
  }

  return "low";
}

function buildJourneyPairs(savedPlaces: SavedPlace[], userLocation: [number, number] | null) {
  if (savedPlaces.length < 2) {
    return [] as Array<{ origin: SavedPlace; destination: SavedPlace; activeOrigin: boolean }>;
  }

  const activeOrigin = userLocation
    ? savedPlaces
        .map((place) => ({
          place,
          distanceMeters: haversineDistanceMeters(userLocation[1], userLocation[0], place.lat, place.lon),
        }))
        .sort((left, right) => left.distanceMeters - right.distanceMeters)[0]
    : null;

  if (activeOrigin && activeOrigin.distanceMeters <= ACTIVE_PLACE_RADIUS_METERS) {
    return savedPlaces
      .filter((place) => place.id !== activeOrigin.place.id)
      .slice(0, MAX_COMMUTE_CARDS)
      .map((destination) => ({ origin: activeOrigin.place, destination, activeOrigin: true }));
  }

  const home = savedPlaces.find((place) => place.kind === "home") ?? null;
  const work = savedPlaces.find((place) => place.kind === "work") ?? null;
  const pairs: Array<{ origin: SavedPlace; destination: SavedPlace; activeOrigin: boolean }> = [];

  if (home && work) {
    pairs.push({ origin: home, destination: work, activeOrigin: false });
    pairs.push({ origin: work, destination: home, activeOrigin: false });
  }

  for (const origin of savedPlaces) {
    for (const destination of savedPlaces) {
      if (origin.id === destination.id) {
        continue;
      }

      const exists = pairs.some((pair) => pair.origin.id === origin.id && pair.destination.id === destination.id);
      if (!exists) {
        pairs.push({ origin, destination, activeOrigin: false });
      }
    }
  }

  return pairs.slice(0, MAX_COMMUTE_CARDS);
}

function getOriginReferencePoint(origin: SavedPlace, userLocation: [number, number] | null) {
  if (!userLocation) {
    return { lat: origin.lat, lon: origin.lon };
  }

  const userDistanceToOrigin = haversineDistanceMeters(userLocation[1], userLocation[0], origin.lat, origin.lon);
  if (userDistanceToOrigin <= ACTIVE_PLACE_RADIUS_METERS) {
    return { lat: userLocation[1], lon: userLocation[0] };
  }

  return { lat: origin.lat, lon: origin.lon };
}

function getTrafficImpactForOption(option: CommuteOption, situations: RoadSituation[]): CommuteTrafficImpact | null {
  if (situations.length === 0) {
    return null;
  }

  const midpoint = {
    lat: (option.originStop.stop_lat + option.destinationStop.stop_lat) / 2,
    lon: (option.originStop.stop_lon + option.destinationStop.stop_lon) / 2,
  };

  const rankedSituations = situations
    .map((situation) => {
      const originDistance = haversineDistanceMeters(option.originStop.stop_lat, option.originStop.stop_lon, situation.lat, situation.lon);
      const destinationDistance = haversineDistanceMeters(option.destinationStop.stop_lat, option.destinationStop.stop_lon, situation.lat, situation.lon);
      const midpointDistance = haversineDistanceMeters(midpoint.lat, midpoint.lon, situation.lat, situation.lon);
      const distanceMeters = Math.round(Math.min(originDistance, destinationDistance, midpointDistance));

      return { situation, distanceMeters };
    })
    .filter((entry) => entry.distanceMeters <= 2500)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);

  const closestSituation = rankedSituations[0];
  if (!closestSituation) {
    return null;
  }

  return {
    id: closestSituation.situation.id,
    label: closestSituation.situation.header || closestSituation.situation.messageType,
    messageType: closestSituation.situation.messageType,
    distanceMeters: closestSituation.distanceMeters,
    webLink: closestSituation.situation.webLink || undefined,
  };
}

export function getTrafficQueryForPlan(plan: CommutePlan | null) {
  if (!plan?.bestOption) {
    return null;
  }

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
    radiusMeters: clamp(Math.round(journeyDistance * 0.8), 2500, 10000),
    limit: 6,
  };
}

export function useCommutePlans({
  savedPlaces,
  userLocation,
  stops,
  stopRoutes,
  routeMap,
  vehicles,
  walkSpeed,
  bufferMinutes,
  maxWalkDistanceMeters,
  roadSituations = [],
}: {
  savedPlaces: SavedPlace[];
  userLocation: [number, number] | null;
  stops: TransitStop[];
  stopRoutes: Record<string, string[]>;
  routeMap: Record<string, string>;
  vehicles: Vehicle[];
  walkSpeed: number;
  bufferMinutes: number;
  maxWalkDistanceMeters: number;
  roadSituations?: RoadSituation[];
}) {
  const [plans, setPlans] = useState<CommutePlan[]>([]);
  const [loading, setLoading] = useState(false);

  const journeyPairs = useMemo(
    () => buildJourneyPairs(savedPlaces, userLocation),
    [savedPlaces, userLocation],
  );

  useEffect(() => {
    if (journeyPairs.length === 0 || stops.length === 0 || vehicles.length === 0) {
      setPlans(
        journeyPairs.map((pair) => ({
          id: `${pair.origin.id}:${pair.destination.id}`,
          origin: pair.origin,
          destination: pair.destination,
          activeOrigin: pair.activeOrigin,
          bestOption: null,
          fallbackOption: null,
          note: stops.length === 0 ? null : "No live departures available right now.",
        })),
      );
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function buildPlan(pair: (typeof journeyPairs)[number]): Promise<CommutePlan> {
      const originReference = getOriginReferencePoint(pair.origin, userLocation);
      const originStops = getNearbyStops(originReference.lat, originReference.lon, stops, maxWalkDistanceMeters);
      const destinationStops = getNearbyStops(pair.destination.lat, pair.destination.lon, stops, maxWalkDistanceMeters);

      if (originStops.length === 0 || destinationStops.length === 0) {
        return {
          id: `${pair.origin.id}:${pair.destination.id}`,
          origin: pair.origin,
          destination: pair.destination,
          activeOrigin: pair.activeOrigin,
          bestOption: null,
          fallbackOption: null,
          note: "No relevant stop is within your walking limit for this commute.",
        };
      }

      const originStopIds = originStops.map((entry) => entry.stop.stop_id);
      const destinationStopIds = destinationStops.map((entry) => entry.stop.stop_id);
      const originRouteIds = new Set(originStopIds.flatMap((stopId) => stopRoutes[stopId] ?? []));
      const destinationRouteIds = new Set(destinationStopIds.flatMap((stopId) => stopRoutes[stopId] ?? []));
      const matchingRouteIds = [...originRouteIds].filter((routeId) => destinationRouteIds.has(routeId));

      if (matchingRouteIds.length === 0) {
        return {
          id: `${pair.origin.id}:${pair.destination.id}`,
          origin: pair.origin,
          destination: pair.destination,
          activeOrigin: pair.activeOrigin,
          bestOption: null,
          fallbackOption: null,
          note: "No direct live route was found between these places right now.",
        };
      }

      const candidateVehicles = vehicles.filter((vehicle) => vehicle.tripId && matchingRouteIds.includes(vehicle.routeId));
      if (candidateVehicles.length === 0) {
        return {
          id: `${pair.origin.id}:${pair.destination.id}`,
          origin: pair.origin,
          destination: pair.destination,
          activeOrigin: pair.activeOrigin,
          bestOption: null,
          fallbackOption: null,
          note: "Relevant lines are not reporting live vehicles right now.",
        };
      }

      const { data, error } = await supabase
        .from("stop_times")
        .select("trip_id, stop_id, stop_sequence")
        .in("trip_id", [...new Set(candidateVehicles.map((vehicle) => vehicle.tripId))])
        .in("stop_id", [...new Set([...originStopIds, ...destinationStopIds])]);

      if (error) {
        throw error;
      }

      const stopTimes = (data ?? []) as StopTimeMatch[];
      const originStopMap = new Map(originStops.map((entry) => [entry.stop.stop_id, entry.stop]));
      const destinationStopMap = new Map(destinationStops.map((entry) => [entry.stop.stop_id, entry.stop]));
      const selectedOriginStop = originStops[0].stop;
      const rawOptions: RawCommuteOption[] = [];

      for (const vehicle of candidateVehicles) {
        const vehicleStopTimes = stopTimes.filter((stopTime) => stopTime.trip_id === vehicle.tripId);
        const originMatch = pickBestUpcomingStopMatch(
          vehicleStopTimes.filter((stopTime) => originStopMap.has(stopTime.stop_id)),
          vehicle,
          selectedOriginStop,
          originStopMap,
        );

        if (!originMatch) {
          continue;
        }

        const destinationMatch = vehicleStopTimes
          .filter((stopTime) => destinationStopMap.has(stopTime.stop_id) && stopTime.stop_sequence > originMatch.stop_sequence)
          .sort((left, right) => {
            if (left.stop_sequence !== right.stop_sequence) {
              return left.stop_sequence - right.stop_sequence;
            }

            const leftStop = destinationStopMap.get(left.stop_id);
            const rightStop = destinationStopMap.get(right.stop_id);
            const leftDistance = leftStop
              ? haversineDistanceMeters(pair.destination.lat, pair.destination.lon, leftStop.stop_lat, leftStop.stop_lon)
              : Number.POSITIVE_INFINITY;
            const rightDistance = rightStop
              ? haversineDistanceMeters(pair.destination.lat, pair.destination.lon, rightStop.stop_lat, rightStop.stop_lon)
              : Number.POSITIVE_INFINITY;

            return leftDistance - rightDistance;
          })[0];

        if (!destinationMatch) {
          continue;
        }

        const originStop = originStopMap.get(originMatch.stop_id);
        const destinationStop = destinationStopMap.get(destinationMatch.stop_id);
        if (!originStop || !destinationStop) {
          continue;
        }

        const originStopDistanceMeters = Math.round(
          haversineDistanceMeters(originReference.lat, originReference.lon, originStop.stop_lat, originStop.stop_lon),
        );
        const destinationStopDistanceMeters = Math.round(
          haversineDistanceMeters(pair.destination.lat, pair.destination.lon, destinationStop.stop_lat, destinationStop.stop_lon),
        );
        const stopCount = destinationMatch.stop_sequence - originMatch.stop_sequence;
        const isTowardOrigin = bearingTowardStop(
          vehicle.lat,
          vehicle.lon,
          vehicle.bearing,
          originStop.stop_lat,
          originStop.stop_lon,
        );

        const approximateScore =
          getApproximateVehicleEta(vehicle, originStop, stopCount, isTowardOrigin) +
          Math.round(originStopDistanceMeters * 0.9) +
          Math.round(destinationStopDistanceMeters * 0.35);

        rawOptions.push({
          vehicle,
          lineNumber: routeMap[vehicle.routeId] || vehicle.vehicleLabel || "?",
          originStop,
          destinationStop,
          originStopDistanceMeters,
          destinationStopDistanceMeters,
          stopCount,
          approximateEtaSeconds: getApproximateVehicleEta(vehicle, originStop, stopCount, isTowardOrigin),
          approximateScore,
          isTowardOrigin,
        });
      }

      if (rawOptions.length === 0) {
        return {
          id: `${pair.origin.id}:${pair.destination.id}`,
          origin: pair.origin,
          destination: pair.destination,
          activeOrigin: pair.activeOrigin,
          bestOption: null,
          fallbackOption: null,
          note: "No upcoming live departure matched this commute right now.",
        };
      }

      const refinedOptions = await Promise.all(
        rawOptions
          .sort((left, right) => left.approximateScore - right.approximateScore)
          .slice(0, MAX_ROUTING_LOOKUPS)
          .map(async (option) => {
            let vehicleEtaSeconds = option.approximateEtaSeconds;

            try {
              const routeDurationSeconds = await getRoadDurationSeconds(option.vehicle, option.originStop, controller.signal);
              if (routeDurationSeconds !== null) {
                vehicleEtaSeconds = Math.round(routeDurationSeconds + Math.max(0, option.stopCount - 1) * 25 + (option.isTowardOrigin ? 0 : 90));
              }
            } catch {
              vehicleEtaSeconds = option.approximateEtaSeconds;
            }

            const walkDistanceMeters = Math.round(
              haversineDistanceMeters(originReference.lat, originReference.lon, option.originStop.stop_lat, option.originStop.stop_lon),
            );
            const walkSeconds = walkDistanceMeters / (Math.max(walkSpeed, 1) / 3.6);
            const destinationWalkDistanceMeters = Math.round(
              haversineDistanceMeters(pair.destination.lat, pair.destination.lon, option.destinationStop.stop_lat, option.destinationStop.stop_lon),
            );
            const destinationWalkSeconds = destinationWalkDistanceMeters / (Math.max(walkSpeed, 1) / 3.6);
            const slackSeconds = Math.round(vehicleEtaSeconds - walkSeconds - bufferMinutes * 60);
            const trafficImpact = getTrafficImpactForOption(
              {
                lineNumber: option.lineNumber,
                tripId: option.vehicle.tripId,
                vehicleId: option.vehicle.vehicleId,
                originStop: option.originStop,
                destinationStop: option.destinationStop,
                originStopDistanceMeters: option.originStopDistanceMeters,
                destinationStopDistanceMeters: option.destinationStopDistanceMeters,
                walkDistanceMeters,
                walkSeconds,
                destinationWalkDistanceMeters,
                destinationWalkSeconds,
                vehicleEtaSeconds,
                slackSeconds,
                guidance: getCommuteGuidance(slackSeconds),
                confidence: getCommuteConfidence(slackSeconds),
                score: 0,
                stopCount: option.stopCount,
                trafficImpact: null,
              },
              roadSituations,
            );
            const trafficPenalty = trafficImpact ? 120 : 0;
            const score = vehicleEtaSeconds + Math.round(destinationWalkSeconds * 0.4) + Math.max(0, -slackSeconds) * 3 + trafficPenalty;

            return {
              lineNumber: option.lineNumber,
              tripId: option.vehicle.tripId,
              vehicleId: option.vehicle.vehicleId,
              originStop: option.originStop,
              destinationStop: option.destinationStop,
              originStopDistanceMeters: option.originStopDistanceMeters,
              destinationStopDistanceMeters: option.destinationStopDistanceMeters,
              walkDistanceMeters,
              walkSeconds,
              destinationWalkDistanceMeters,
              destinationWalkSeconds,
              vehicleEtaSeconds,
              slackSeconds,
              guidance: getCommuteGuidance(slackSeconds),
              confidence: getCommuteConfidence(slackSeconds),
              score,
              stopCount: option.stopCount,
              trafficImpact,
            } satisfies CommuteOption;
          }),
      );

      const rankedOptions = refinedOptions.sort((left, right) => left.score - right.score);

      return {
        id: `${pair.origin.id}:${pair.destination.id}`,
        origin: pair.origin,
        destination: pair.destination,
        activeOrigin: pair.activeOrigin,
        bestOption: rankedOptions[0] ?? null,
        fallbackOption: rankedOptions[1] ?? null,
        note: rankedOptions[0] ? null : "No reliable live journey is available right now.",
      };
    }

    async function loadPlans() {
      setLoading(true);

      try {
        const nextPlans = await Promise.all(journeyPairs.map(buildPlan));
        if (!cancelled) {
          setPlans(nextPlans);
        }
      } catch (error) {
        console.warn("Commute planning failed", error);
        if (!cancelled) {
          setPlans(
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
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPlans();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bufferMinutes, journeyPairs, maxWalkDistanceMeters, roadSituations, routeMap, stopRoutes, stops, userLocation, vehicles, walkSpeed]);

  return { plans, loading };
}
