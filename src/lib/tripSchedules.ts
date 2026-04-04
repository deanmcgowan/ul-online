import type { Vehicle } from "@/components/BusMap";
import { haversineDistanceMeters } from "@/lib/transitMatching";

export interface ScheduledStopTimeRow {
  trip_id: string;
  stop_id: string;
  stop_sequence: number;
  arrival_time: string | null;
  departure_time: string | null;
}

export function parseGtfsTimeToSeconds(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }

  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function buildTripScheduleMap(rows: ScheduledStopTimeRow[]) {
  const scheduleMap = new Map<string, ScheduledStopTimeRow[]>();

  for (const row of rows) {
    const currentRows = scheduleMap.get(row.trip_id);
    if (currentRows) {
      currentRows.push(row);
    } else {
      scheduleMap.set(row.trip_id, [row]);
    }
  }

  for (const [tripId, tripRows] of scheduleMap.entries()) {
    scheduleMap.set(
      tripId,
      tripRows.sort((left, right) => left.stop_sequence - right.stop_sequence),
    );
  }

  return scheduleMap;
}

function getReferenceScheduleSeconds(vehicle: Vehicle, currentRow: ScheduledStopTimeRow) {
  const arrivalSeconds = parseGtfsTimeToSeconds(currentRow.arrival_time);
  const departureSeconds = parseGtfsTimeToSeconds(currentRow.departure_time);

  if (vehicle.currentStatus === "STOPPED_AT") {
    return departureSeconds ?? arrivalSeconds;
  }

  if (vehicle.currentStatus === "INCOMING_AT" || vehicle.currentStatus === "IN_TRANSIT_TO") {
    return arrivalSeconds ?? departureSeconds;
  }

  return departureSeconds ?? arrivalSeconds;
}

export function estimateRemainingTripSeconds(
  vehicle: Vehicle,
  tripRows: ScheduledStopTimeRow[],
  targetStopSequence: number,
): number | null {
  const targetRow = tripRows.find((row) => row.stop_sequence === targetStopSequence);
  if (!targetRow) {
    return null;
  }

  const currentRow =
    tripRows.find((row) => row.stop_sequence === vehicle.currentStopSequence) ??
    tripRows.find((row) => row.stop_sequence > vehicle.currentStopSequence);

  if (!currentRow || targetRow.stop_sequence < currentRow.stop_sequence) {
    return null;
  }

  const referenceSeconds = getReferenceScheduleSeconds(vehicle, currentRow);
  const targetSeconds = parseGtfsTimeToSeconds(targetRow.arrival_time) ?? parseGtfsTimeToSeconds(targetRow.departure_time);

  if (referenceSeconds === null || targetSeconds === null) {
    return null;
  }

  return Math.max(0, targetSeconds - referenceSeconds);
}

export function getTripTerminalStopId(tripRows: ScheduledStopTimeRow[]): string | null {
  return tripRows[tripRows.length - 1]?.stop_id ?? null;
}

export function inferEffectiveStopSequence(
  vehicleLat: number,
  vehicleLon: number,
  reportedSequence: number,
  targetSequence: number,
  tripRows: ScheduledStopTimeRow[],
  stopPositionLookup: ReadonlyMap<string, { stop_lat: number; stop_lon: number }>,
): number {
  let closestSequence = reportedSequence;
  let closestDistance = Infinity;

  for (const row of tripRows) {
    if (row.stop_sequence < reportedSequence || row.stop_sequence >= targetSequence) {
      continue;
    }

    const pos = stopPositionLookup.get(row.stop_id);
    if (!pos) {
      continue;
    }

    const dist = haversineDistanceMeters(vehicleLat, vehicleLon, pos.stop_lat, pos.stop_lon);
    if (dist < closestDistance) {
      closestDistance = dist;
      closestSequence = row.stop_sequence;
    }
  }

  return Math.max(reportedSequence, closestSequence);
}