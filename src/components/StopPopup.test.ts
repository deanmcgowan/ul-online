import { describe, expect, it } from "vitest";
import type { TransitStop, Vehicle } from "@/components/BusMap";
import { pickBestUpcomingStopMatch, stabilizeArrivalEstimate } from "@/components/StopPopup";

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
});