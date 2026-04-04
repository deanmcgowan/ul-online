import { describe, expect, it } from "vitest";
import type { TransitStop, Vehicle } from "@/components/BusMap";
import { buildFallbackArrivalEstimate, getRemainingArrivalSeconds, pickBestUpcomingStopMatch, pickPreferredDestinationName, stabilizeArrivalEstimate } from "@/components/StopPopup";
import type { TransitPlatformGroup } from "@/lib/stopGroups";
import { estimateRemainingTripSeconds, inferEffectiveStopSequence, parseGtfsTimeToSeconds } from "@/lib/tripSchedules";

function createStop(overrides: Partial<TransitStop>): TransitStop {
  return {
    stop_id: "stop-a",
    stop_name: "Centralen",
    stop_lat: 59.8586,
    stop_lon: 17.6389,
    ...overrides,
  };
}

function createVehicle(overrides: Partial<Vehicle>): Vehicle {
  return {
    id: "vehicle-1",
    tripId: "trip-1",
    routeId: "route-1",
    directionId: 0,
    currentStatus: "",
    lat: 59.8586,
    lon: 17.6389,
    bearing: 90,
    speed: 8,
    stopId: "",
    currentStopSequence: 10,
    vehicleId: "veh-1",
    vehicleLabel: "1",
    timestamp: Date.now(),
    ...overrides,
  };
}

function createPlatformGroup(overrides: Partial<TransitPlatformGroup> = {}): TransitPlatformGroup {
  const representativeStop = createStop({ stop_id: "stop-a" });
  return {
    platform_id: "platform-a",
    stop_name: representativeStop.stop_name,
    stop_lat: representativeStop.stop_lat,
    stop_lon: representativeStop.stop_lon,
    stops: [representativeStop],
    routeIds: ["route-1"],
    representativeStop,
    ...overrides,
  };
}

describe("pickBestUpcomingStopMatch", () => {
  it("prefers the soonest upcoming physical stop over a later exact stop id", () => {
    const selectedStop = createStop({ stop_id: "stop-a" });
    const siblingStop = createStop({
      stop_id: "stop-b",
      stop_name: "Centralen B",
      stop_lat: 59.85875,
      stop_lon: 17.63905,
    });
    const vehicle = createVehicle({ tripId: "trip-1", currentStopSequence: 10 });
    const relatedStopMap = new Map([
      [selectedStop.stop_id, selectedStop],
      [siblingStop.stop_id, siblingStop],
    ]);

    const match = pickBestUpcomingStopMatch(
      [
        { trip_id: "trip-1", stop_id: siblingStop.stop_id, stop_sequence: 12 },
        { trip_id: "trip-1", stop_id: selectedStop.stop_id, stop_sequence: 37 },
      ],
      vehicle,
      selectedStop,
      relatedStopMap,
    );

    expect(match?.stop_id).toBe(siblingStop.stop_id);
    expect(match?.stop_sequence).toBe(12);
  });

  it("keeps a same-sequence stop when GTFS says the bus is still in transit to it", () => {
    const selectedStop = createStop({ stop_id: "stop-a" });
    const vehicle = createVehicle({
      tripId: "trip-1",
      stopId: selectedStop.stop_id,
      currentStopSequence: 12,
      currentStatus: "IN_TRANSIT_TO",
      lat: selectedStop.stop_lat,
      lon: selectedStop.stop_lon + 0.0012,
      bearing: 90,
    });
    const relatedStopMap = new Map([[selectedStop.stop_id, selectedStop]]);

    const match = pickBestUpcomingStopMatch(
      [{ trip_id: "trip-1", stop_id: selectedStop.stop_id, stop_sequence: 12 }],
      vehicle,
      selectedStop,
      relatedStopMap,
    );

    expect(match?.stop_id).toBe(selectedStop.stop_id);
    expect(match?.stop_sequence).toBe(12);
  });

  it("ignores a same-sequence stop after the bus has already passed it", () => {
    const selectedStop = createStop({ stop_id: "stop-a" });
    const relatedStopMap = new Map([[selectedStop.stop_id, selectedStop]]);
    const vehicle = createVehicle({
      tripId: "trip-1",
      currentStopSequence: 12,
      lat: selectedStop.stop_lat,
      lon: selectedStop.stop_lon + 0.0012,
      bearing: 90,
    });

    const match = pickBestUpcomingStopMatch(
      [{ trip_id: "trip-1", stop_id: selectedStop.stop_id, stop_sequence: 12 }],
      vehicle,
      selectedStop,
      relatedStopMap,
    );

    expect(match).toBeUndefined();
  });

  it("ignores a much later repeated stop when the bus is moving away from it", () => {
    const selectedStop = createStop({ stop_id: "stop-a" });
    const relatedStopMap = new Map([[selectedStop.stop_id, selectedStop]]);
    const vehicle = createVehicle({
      tripId: "trip-1",
      currentStopSequence: 12,
      lat: selectedStop.stop_lat,
      lon: selectedStop.stop_lon + 0.002,
      bearing: 90,
    });

    const match = pickBestUpcomingStopMatch(
      [{ trip_id: "trip-1", stop_id: selectedStop.stop_id, stop_sequence: 28 }],
      vehicle,
      selectedStop,
      relatedStopMap,
    );

    expect(match).toBeUndefined();
  });
});

describe("stabilizeArrivalEstimate", () => {
  it("limits upward jumps for the same approaching trip", () => {
    const previous = {
      etaSeconds: 120,
      lineNumber: "1",
      tripId: "trip-1",
      vehicleId: "veh-1",
      stopSequence: 12,
      rankingScore: 120,
      calculatedAt: Date.now() - 10_000,
    };

    const next = {
      etaSeconds: 240,
      lineNumber: "1",
      tripId: "trip-1",
      vehicleId: "veh-1",
      stopSequence: 12,
      rankingScore: 240,
    };

    const stabilized = stabilizeArrivalEstimate(next, previous);

    expect(stabilized.etaSeconds).toBeLessThanOrEqual(155);
    expect(stabilized.tripId).toBe("trip-1");
  });

  it("counts down arrival seconds while a popup stays open", () => {
    const arrival = {
      etaSeconds: 120,
      lineNumber: "1",
      tripId: "trip-1",
      vehicleId: "veh-1",
      stopSequence: 12,
      rankingScore: 120,
      calculatedAt: 1_000,
    };

    expect(getRemainingArrivalSeconds(arrival, 31_000)).toBe(90);
    expect(getRemainingArrivalSeconds(arrival, 121_000)).toBe(0);
  });
});

describe("buildFallbackArrivalEstimate", () => {
  it("returns a fallback estimate for a nearby approaching vehicle on a serving route", () => {
    const platform = createPlatformGroup();
    const vehicle = createVehicle({
      routeId: "route-1",
      tripId: "trip-1",
      lat: platform.stop_lat - 0.01,
      lon: platform.stop_lon,
      bearing: 0,
      speed: 12,
    });

    const estimate = buildFallbackArrivalEstimate(platform, [vehicle], { "route-1": "821" });

    expect(estimate?.lineNumber).toBe("821");
    expect(estimate?.etaSeconds).toBeGreaterThan(0);
  });

  it("includes the trip terminal name in fallback estimates when schedule rows are available", () => {
    const platform = createPlatformGroup();
    const vehicle = createVehicle({
      routeId: "route-1",
      tripId: "trip-1",
      lat: platform.stop_lat - 0.002,
      lon: platform.stop_lon,
      bearing: 0,
      speed: 12,
    });

    const estimate = buildFallbackArrivalEstimate(
      platform,
      [vehicle],
      { "route-1": "100" },
      new Map([
        [
          "trip-1",
          [
            { trip_id: "trip-1", stop_id: "stop-a", stop_sequence: 10, arrival_time: "12:00:00", departure_time: "12:00:30" },
            { trip_id: "trip-1", stop_id: "uppsala", stop_sequence: 20, arrival_time: "12:16:00", departure_time: "12:16:20" },
          ],
        ],
      ]),
      new Map([
        ["uppsala", "Uppsala Centralstationen"],
      ]),
    );

    expect(estimate?.destinationName).toBe("Uppsala Centralstationen");
    expect(estimate?.scheduledTimeText).toBe("12:00");
  });

  it("ignores a vehicle on the right route when it is moving away from the stop", () => {
    const platform = createPlatformGroup();
    const vehicle = createVehicle({
      routeId: "route-1",
      tripId: "trip-1",
      lat: platform.stop_lat - 0.04,
      lon: platform.stop_lon,
      bearing: 180,
      speed: 12,
    });

    const estimate = buildFallbackArrivalEstimate(platform, [vehicle], { "route-1": "821" });

    expect(estimate).toBeNull();
  });

  it("ignores a vehicle that has reached its terminal stop", () => {
    const platform = createPlatformGroup();
    const vehicle = createVehicle({
      routeId: "route-1",
      tripId: "trip-1",
      currentStopSequence: 20,
      lat: platform.stop_lat - 0.002,
      lon: platform.stop_lon,
      bearing: 0,
      speed: 8,
    });

    const estimate = buildFallbackArrivalEstimate(
      platform,
      [vehicle],
      { "route-1": "100" },
      new Map([
        [
          "trip-1",
          [
            { trip_id: "trip-1", stop_id: "stop-x", stop_sequence: 10, arrival_time: "12:00:00", departure_time: "12:00:30" },
            { trip_id: "trip-1", stop_id: "terminal", stop_sequence: 20, arrival_time: "12:16:00", departure_time: null },
          ],
        ],
      ]),
    );

    expect(estimate).toBeNull();
  });
});

describe("trip schedule timing", () => {
  it("parses GTFS times beyond 24:00", () => {
    expect(parseGtfsTimeToSeconds("25:10:30")).toBe(90630);
  });

  it("uses scheduled sequence time to account for loops before reaching a later stop", () => {
    const vehicle = createVehicle({
      tripId: "trip-1",
      currentStopSequence: 10,
      currentStatus: "IN_TRANSIT_TO",
    });

    const remainingSeconds = estimateRemainingTripSeconds(
      vehicle,
      [
        { trip_id: "trip-1", stop_id: "loop-a", stop_sequence: 10, arrival_time: "12:00:00", departure_time: "12:00:30" },
        { trip_id: "trip-1", stop_id: "loop-b", stop_sequence: 11, arrival_time: "12:02:00", departure_time: "12:02:20" },
        { trip_id: "trip-1", stop_id: "loop-c", stop_sequence: 12, arrival_time: "12:04:00", departure_time: "12:04:20" },
        { trip_id: "trip-1", stop_id: "target", stop_sequence: 13, arrival_time: "12:06:00", departure_time: "12:06:10" },
      ],
      13,
    );

    expect(remainingSeconds).toBe(360);
  });
});

describe("pickPreferredDestinationName", () => {
  it("prefers the best-ranked terminal destination over unnamed arrivals", () => {
    const destinationName = pickPreferredDestinationName(
      [
        { destinationName: null, rankingScore: 120, etaSeconds: 120 },
        { destinationName: "Uppsala Centralstationen", rankingScore: 150, etaSeconds: 150 },
        { destinationName: "Tierp station", rankingScore: 210, etaSeconds: 210 },
      ],
      "Stora Vallskog",
    );

    expect(destinationName).toBe("Uppsala Centralstationen");
  });

  it("does not fall back to compass logic when no terminal name is available", () => {
    const destinationName = pickPreferredDestinationName(
      [
        { destinationName: null, rankingScore: 120, etaSeconds: 120 },
      ],
      "Stora Vallskog",
    );

    expect(destinationName).toBeNull();
  });
});

describe("inferEffectiveStopSequence", () => {
  const stopPositions = new Map([
    ["stop-1", { stop_lat: 59.850, stop_lon: 17.630 }],
    ["stop-2", { stop_lat: 59.853, stop_lon: 17.633 }],
    ["stop-3", { stop_lat: 59.856, stop_lon: 17.636 }],
    ["stop-4", { stop_lat: 59.859, stop_lon: 17.639 }],
    ["stop-5", { stop_lat: 59.862, stop_lon: 17.642 }],
  ]);

  const tripRows = [
    { trip_id: "trip-1", stop_id: "stop-1", stop_sequence: 10, arrival_time: "12:00:00", departure_time: "12:00:30" },
    { trip_id: "trip-1", stop_id: "stop-2", stop_sequence: 11, arrival_time: "12:02:00", departure_time: "12:02:20" },
    { trip_id: "trip-1", stop_id: "stop-3", stop_sequence: 12, arrival_time: "12:04:00", departure_time: "12:04:20" },
    { trip_id: "trip-1", stop_id: "stop-4", stop_sequence: 13, arrival_time: "12:06:00", departure_time: "12:06:20" },
    { trip_id: "trip-1", stop_id: "stop-5", stop_sequence: 14, arrival_time: "12:08:00", departure_time: "12:08:20" },
  ];

  it("advances the effective sequence when the bus is physically near a later stop", () => {
    const effective = inferEffectiveStopSequence(
      59.856, 17.636, // near stop-3
      10, 14, tripRows, stopPositions,
    );

    expect(effective).toBe(12);
  });

  it("never goes below the reported sequence", () => {
    const effective = inferEffectiveStopSequence(
      59.850, 17.630, // near stop-1 (reported sequence)
      10, 14, tripRows, stopPositions,
    );

    expect(effective).toBe(10);
  });

  it("does not advance past the target sequence", () => {
    const effective = inferEffectiveStopSequence(
      59.862, 17.642, // right at stop-5 (target)
      10, 14, tripRows, stopPositions,
    );

    // Should return 13 (stop-4), not 14 (the target itself is excluded)
    expect(effective).toBe(13);
  });

  it("keeps reported sequence when positions are unavailable", () => {
    const emptyPositions = new Map<string, { stop_lat: number; stop_lon: number }>();
    const effective = inferEffectiveStopSequence(
      59.856, 17.636,
      10, 14, tripRows, emptyPositions,
    );

    expect(effective).toBe(10);
  });

  it("reduces scheduled ETA when bus has progressed past reported stop", () => {
    // Bus reported at stop-1 (seq 10), but physically near stop-3 (seq 12)
    const vehicle = createVehicle({
      tripId: "trip-1",
      currentStopSequence: 10,
      currentStatus: "IN_TRANSIT_TO",
      lat: 59.856,
      lon: 17.636,
    });

    const effectiveSequence = inferEffectiveStopSequence(
      vehicle.lat, vehicle.lon,
      vehicle.currentStopSequence, 14, tripRows, stopPositions,
    );

    const effectiveVehicle = { ...vehicle, currentStopSequence: effectiveSequence, currentStatus: "IN_TRANSIT_TO" as const };

    const staleEta = estimateRemainingTripSeconds(vehicle, tripRows, 14);
    const adjustedEta = estimateRemainingTripSeconds(effectiveVehicle, tripRows, 14);

    // Stale: 12:08 - 12:00 = 480s, Adjusted: 12:08 - 12:04 = 240s
    expect(staleEta).toBe(480);
    expect(adjustedEta).toBe(240);
  });
});