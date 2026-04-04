import type { TransitStop } from "@/components/BusMap";
import { haversineDistanceMeters } from "@/lib/transitMatching";

const GROUP_CELL_SIZE = 0.0015;
const VISUAL_STOP_GROUP_RADIUS_METERS = 140;
const SAME_PLATFORM_RADIUS_METERS = 8;

function shouldMergePlatforms(leftStop: TransitStop, rightStop: TransitStop, distanceMeters: number): boolean {
  if (leftStop.stop_id === rightStop.stop_id) {
    return true;
  }
  
  if (distanceMeters > SAME_PLATFORM_RADIUS_METERS) {
    return false;
  }
  
  return false;
}

export interface TransitStopGroup {
  group_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  stops: TransitStop[];
  routeIds: string[];
}

export interface TransitPlatformGroup {
  platform_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  stops: TransitStop[];
  routeIds: string[];
  representativeStop: TransitStop;
}

function getCellKey(stop: TransitStop) {
  return `${Math.floor(stop.stop_lat / GROUP_CELL_SIZE)},${Math.floor(stop.stop_lon / GROUP_CELL_SIZE)}`;
}

function findRoot(parent: number[], index: number): number {
  if (parent[index] !== index) {
    parent[index] = findRoot(parent, parent[index]);
  }

  return parent[index];
}

function unionRoots(parent: number[], rank: number[], left: number, right: number) {
  const leftRoot = findRoot(parent, left);
  const rightRoot = findRoot(parent, right);

  if (leftRoot === rightRoot) {
    return;
  }

  if (rank[leftRoot] < rank[rightRoot]) {
    parent[leftRoot] = rightRoot;
    return;
  }

  if (rank[leftRoot] > rank[rightRoot]) {
    parent[rightRoot] = leftRoot;
    return;
  }

  parent[rightRoot] = leftRoot;
  rank[leftRoot] += 1;
}

function chooseGroupName(stops: TransitStop[]): string {
  const counts = new Map<string, number>();

  for (const stop of stops) {
    counts.set(stop.stop_name, (counts.get(stop.stop_name) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0], undefined, { sensitivity: "base" });
    })[0]?.[0] ?? stops[0]?.stop_name ?? "";
}

function sortStops(stops: TransitStop[]): TransitStop[] {
  return [...stops].sort((left, right) => {
    const nameOrder = left.stop_name.localeCompare(right.stop_name, undefined, {
      sensitivity: "base",
      numeric: true,
    });

    if (nameOrder !== 0) {
      return nameOrder;
    }

    return left.stop_id.localeCompare(right.stop_id, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

function getRepresentativeStop(stops: TransitStop[], stopRoutes: Record<string, string[]>) {
  return [...stops].sort((left, right) => {
    const leftRouteCount = stopRoutes[left.stop_id]?.length ?? 0;
    const rightRouteCount = stopRoutes[right.stop_id]?.length ?? 0;

    if (leftRouteCount !== rightRouteCount) {
      return rightRouteCount - leftRouteCount;
    }

    const leftNameLength = left.stop_name.length;
    const rightNameLength = right.stop_name.length;
    if (leftNameLength !== rightNameLength) {
      return leftNameLength - rightNameLength;
    }

    return left.stop_id.localeCompare(right.stop_id, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  })[0];
}

function normalizeStopName(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[()]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function getSharedTokenCount(left: string, right: string) {
  const leftTokens = new Set(normalizeStopName(left));
  const rightTokens = new Set(normalizeStopName(right));
  let shared = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }

  return shared;
}

function hasRouteOverlap(
  stop: TransitStop,
  candidate: TransitStop,
  stopRoutes: Record<string, string[]>,
): boolean {
  const leftRoutes = stopRoutes[stop.stop_id];
  const rightRoutes = stopRoutes[candidate.stop_id];

  if (!leftRoutes?.length || !rightRoutes?.length) {
    return true;
  }

  const rightSet = new Set(rightRoutes);
  return leftRoutes.some((route) => rightSet.has(route));
}

function isStrongNameMatch(stop: TransitStop, candidate: TransitStop): boolean {
  const leftTokens = normalizeStopName(stop.stop_name);
  const rightTokens = normalizeStopName(candidate.stop_name);
  const shared = getSharedTokenCount(stop.stop_name, candidate.stop_name);
  return shared >= Math.min(leftTokens.length, rightTokens.length);
}

function isSameVisualStopGroup(stop: TransitStop, candidate: TransitStop): boolean {
  if (candidate.stop_id === stop.stop_id) {
    return true;
  }

  const distanceMeters = Math.hypot(stop.stop_lat - candidate.stop_lat, stop.stop_lon - candidate.stop_lon);
  const geographicDistanceApprox = distanceMeters * 111_320;

  if (geographicDistanceApprox > VISUAL_STOP_GROUP_RADIUS_METERS) {
    return false;
  }

  const leftTokens = normalizeStopName(stop.stop_name);
  const rightTokens = normalizeStopName(candidate.stop_name);
  const shared = getSharedTokenCount(stop.stop_name, candidate.stop_name);

  // If the shorter name is fully contained in the longer name's tokens, merge.
  // Otherwise require at least 2 shared tokens to avoid false merges.
  const minTokenCount = Math.min(leftTokens.length, rightTokens.length);
  const minShared = minTokenCount <= 1 ? 1 : 2;

  return shared >= minShared;
}

export function buildStopGroups(
  stops: TransitStop[],
  stopRoutes: Record<string, string[]> = {},
): TransitStopGroup[] {
  if (stops.length === 0) {
    return [];
  }

  const parent = stops.map((_, index) => index);
  const rank = stops.map(() => 0);
  const cells = new Map<string, number[]>();

  stops.forEach((stop, index) => {
    const [cellLat, cellLon] = getCellKey(stop).split(",").map(Number);

    for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
      for (let lonOffset = -1; lonOffset <= 1; lonOffset += 1) {
        const neighborKey = `${cellLat + latOffset},${cellLon + lonOffset}`;
        const neighborIndexes = cells.get(neighborKey) ?? [];

        for (const neighborIndex of neighborIndexes) {
          if (
            isSameVisualStopGroup(stop, stops[neighborIndex]) &&
            (isStrongNameMatch(stop, stops[neighborIndex]) ||
              hasRouteOverlap(stop, stops[neighborIndex], stopRoutes))
          ) {
            unionRoots(parent, rank, index, neighborIndex);
          }
        }
      }
    }

    const ownKey = `${cellLat},${cellLon}`;
    const existingIndexes = cells.get(ownKey);
    if (existingIndexes) {
      existingIndexes.push(index);
    } else {
      cells.set(ownKey, [index]);
    }
  });

  const groupedStops = new Map<number, TransitStop[]>();

  stops.forEach((stop, index) => {
    const root = findRoot(parent, index);
    const members = groupedStops.get(root);

    if (members) {
      members.push(stop);
    } else {
      groupedStops.set(root, [stop]);
    }
  });

  return Array.from(groupedStops.values())
    .map((members) => {
      const sortedMembers = sortStops(members);
      const stop_lat = sortedMembers.reduce((total, stop) => total + stop.stop_lat, 0) / sortedMembers.length;
      const stop_lon = sortedMembers.reduce((total, stop) => total + stop.stop_lon, 0) / sortedMembers.length;
      const routeIds = Array.from(
        new Set(sortedMembers.flatMap((stop) => stopRoutes[stop.stop_id] ?? [])),
      ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true }));

      return {
        group_id: sortedMembers.map((stop) => stop.stop_id).join("|"),
        stop_name: chooseGroupName(sortedMembers),
        stop_lat,
        stop_lon,
        stops: sortedMembers,
        routeIds,
      } satisfies TransitStopGroup;
    })
    .sort((left, right) => {
      const nameOrder = left.stop_name.localeCompare(right.stop_name, undefined, {
        sensitivity: "base",
        numeric: true,
      });

      if (nameOrder !== 0) {
        return nameOrder;
      }

      return left.group_id.localeCompare(right.group_id, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
}

export function findStopGroupForStop(
  stop: TransitStop,
  stopGroups: TransitStopGroup[],
): TransitStopGroup | null {
  const exactMatch = stopGroups.find((group) =>
    group.stops.some((member) => member.stop_id === stop.stop_id),
  );

  if (exactMatch) {
    return exactMatch;
  }

  return stopGroups.find((group) => group.stops.some((member) => isSameVisualStopGroup(stop, member))) ?? null;
}

function createPlatformGroup(stops: TransitStop[], stopRoutes: Record<string, string[]>): TransitPlatformGroup {
  const sortedStops = sortStops(stops);
  const representativeStop = getRepresentativeStop(sortedStops, stopRoutes);

  return {
    platform_id: sortedStops.map((stop) => stop.stop_id).join("|"),
    stop_name: representativeStop.stop_name,
    stop_lat: sortedStops.reduce((total, stop) => total + stop.stop_lat, 0) / sortedStops.length,
    stop_lon: sortedStops.reduce((total, stop) => total + stop.stop_lon, 0) / sortedStops.length,
    stops: sortedStops,
    routeIds: Array.from(
      new Set(sortedStops.flatMap((stop) => stopRoutes[stop.stop_id] ?? [])),
    ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })),
    representativeStop,
  } satisfies TransitPlatformGroup;
}

function canMergePlatformGroups(leftGroup: TransitPlatformGroup, rightGroup: TransitPlatformGroup): boolean {
  const leftId = leftGroup.stops[0]?.stop_id;
  const rightId = rightGroup.stops[0]?.stop_id;

  if (!leftId || !rightId) {
    return false;
  }

  return leftId === rightId;
}

function mergeClosestPlatformGroups(groups: TransitPlatformGroup[], stopRoutes: Record<string, string[]>) {
  if (groups.length <= 2) {
    return groups;
  }

  let bestPair: [number, number] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let leftIndex = 0; leftIndex < groups.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
      if (!canMergePlatformGroups(groups[leftIndex], groups[rightIndex])) {
        continue;
      }

      const distance = haversineDistanceMeters(
        groups[leftIndex].stop_lat,
        groups[leftIndex].stop_lon,
        groups[rightIndex].stop_lat,
        groups[rightIndex].stop_lon,
      );

      if (distance < bestDistance) {
        bestDistance = distance;
        bestPair = [leftIndex, rightIndex];
      }
    }
  }

  if (!bestPair) {
    return groups;
  }

  const [leftIndex, rightIndex] = bestPair;
  const mergedStops = [...groups[leftIndex].stops, ...groups[rightIndex].stops];

  return groups
    .filter((_, index) => index !== leftIndex && index !== rightIndex)
    .concat(createPlatformGroup(mergedStops, stopRoutes));
}

export function buildPlatformGroups(
  stopGroup: TransitStopGroup,
  stopRoutes: Record<string, string[]> = {},
): TransitPlatformGroup[] {
  if (stopGroup.stops.length === 0) {
    return [];
  }

  const parent = stopGroup.stops.map((_, index) => index);
  const rank = stopGroup.stops.map(() => 0);

  for (let leftIndex = 0; leftIndex < stopGroup.stops.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < stopGroup.stops.length; rightIndex += 1) {
      const leftStop = stopGroup.stops[leftIndex];
      const rightStop = stopGroup.stops[rightIndex];
      const distance = haversineDistanceMeters(
        leftStop.stop_lat,
        leftStop.stop_lon,
        rightStop.stop_lat,
        rightStop.stop_lon,
      );

      if (shouldMergePlatforms(leftStop, rightStop, distance)) {
        unionRoots(parent, rank, leftIndex, rightIndex);
      }
    }
  }

  const groupedPlatforms = new Map<number, TransitStop[]>();
  stopGroup.stops.forEach((stop, index) => {
    const root = findRoot(parent, index);
    const members = groupedPlatforms.get(root);

    if (members) {
      members.push(stop);
    } else {
      groupedPlatforms.set(root, [stop]);
    }
  });

  let platforms = Array.from(groupedPlatforms.values()).map((stops) => createPlatformGroup(stops, stopRoutes));

  if (platforms.length === 3 && stopGroup.stops.length <= 4) {
    platforms = mergeClosestPlatformGroups(platforms, stopRoutes);
  }

  return platforms.sort((left, right) => {
    const nameOrder = left.stop_name.localeCompare(right.stop_name, undefined, {
      sensitivity: "base",
      numeric: true,
    });

    if (nameOrder !== 0) {
      return nameOrder;
    }

    return left.platform_id.localeCompare(right.platform_id, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}