import { describe, expect, it } from "vitest";
import type { TransitStop, Vehicle } from "@/components/BusMap";
import { buildFallbackArrivalEstimate, getRemainingArrivalSeconds, pickBestUpcomingStopMatch, pickPreferredDestinationName, stabilizeArrivalEstimate } from "@/components/StopPopup";
import type { TransitPlatformGroup } from "@/lib/stopGroups";
import { estimateRemainingTripSeconds, parseGtfsTimeToSeconds } from "@/lib/tripSchedules";

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