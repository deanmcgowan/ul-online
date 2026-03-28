import type { TransitStop, Vehicle } from "@/components/BusMap";
import { bearingTowardStop } from "@/lib/busIcon";

export interface StopTimeMatch {
  stop_id: string;
  stop_sequence: number;
  trip_id: string;
}

const PRIMARY_STOP_GROUP_RADIUS_METERS = 90;
const SECONDARY_STOP_GROUP_RADIUS_METERS = 140;
const SAME_SEQUENCE_STOP_GRACE_METERS = 45;

export function haversineDistanceMeters(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const earthRadius = 6371000;
  const dLat = ((toLat - fromLat) * Math.PI) / 180;
  const dLon = ((toLon - fromLon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((fromLat * Math.PI) / 180) *
      Math.cos((toLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isSameStopGroup(stop: TransitStop, candidate: TransitStop): boolean {
  if (candidate.stop_id === stop.stop_id) {
    return true;
  }

  const distance = haversineDistanceMeters(
    stop.stop_lat,
    stop.stop_lon,
    candidate.stop_lat,
    candidate.stop_lon,
  );

  if (distance <= PRIMARY_STOP_GROUP_RADIUS_METERS) {
    return true;
  }

  return candidate.stop_name === stop.stop_name && distance <= SECONDARY_STOP_GROUP_RADIUS_METERS;
}

export function pickBestUpcomingStopMatch(
  stopTimes: StopTimeMatch[],
  vehicle: Vehicle,
  selectedStop: TransitStop,
  relatedStopMap: ReadonlyMap<string, TransitStop>,
) {
  return stopTimes
    .filter((stopTime) => {
      if (stopTime.trip_id !== vehicle.tripId) {
        return false;
      }

      if (stopTime.stop_sequence > vehicle.currentStopSequence) {
        return true;
      }

      if (stopTime.stop_sequence < vehicle.currentStopSequence) {
        return false;
      }

      if (
        vehicle.currentStatus === "IN_TRANSIT_TO" ||
        vehicle.currentStatus === "INCOMING_AT" ||
        vehicle.currentStatus === "STOPPED_AT"
      ) {
        if (!vehicle.stopId) {
          return true;
        }

        const currentStop = relatedStopMap.get(vehicle.stopId);
        const matchedStop = relatedStopMap.get(stopTime.stop_id);

        if (!matchedStop) {
          return false;
        }

        if (vehicle.stopId === stopTime.stop_id) {
          return true;
        }

        if (!currentStop) {
          return false;
        }

        return isSameStopGroup(currentStop, matchedStop);
      }

      const matchedStop = relatedStopMap.get(stopTime.stop_id);
      if (!matchedStop) {
        return false;
      }

      const distanceToStop = haversineDistanceMeters(
        vehicle.lat,
        vehicle.lon,
        matchedStop.stop_lat,
        matchedStop.stop_lon,
      );

      if (distanceToStop <= SAME_SEQUENCE_STOP_GRACE_METERS) {
        return true;
      }

      return bearingTowardStop(
        vehicle.lat,
        vehicle.lon,
        vehicle.bearing,
        matchedStop.stop_lat,
        matchedStop.stop_lon,
      );
    })
    .sort((left, right) => {
      const leftStop = relatedStopMap.get(left.stop_id);
      const rightStop = relatedStopMap.get(right.stop_id);

      if (left.stop_sequence !== right.stop_sequence) {
        return left.stop_sequence - right.stop_sequence;
      }

      const leftDistance = leftStop
        ? haversineDistanceMeters(selectedStop.stop_lat, selectedStop.stop_lon, leftStop.stop_lat, leftStop.stop_lon)
        : Number.POSITIVE_INFINITY;
      const rightDistance = rightStop
        ? haversineDistanceMeters(selectedStop.stop_lat, selectedStop.stop_lon, rightStop.stop_lat, rightStop.stop_lon)
        : Number.POSITIVE_INFINITY;

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      const leftExact = left.stop_id === selectedStop.stop_id ? 0 : 1;
      const rightExact = right.stop_id === selectedStop.stop_id ? 0 : 1;

      return leftExact - rightExact;
    })[0];
}
