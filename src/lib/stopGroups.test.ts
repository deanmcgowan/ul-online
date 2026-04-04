import { describe, expect, it } from "vitest";
import type { TransitStop } from "@/components/BusMap";
import { buildPlatformGroups, buildStopGroups, findStopGroupForStop } from "@/lib/stopGroups";

function createStop(overrides: Partial<TransitStop>): TransitStop {
  return {
    stop_id: "stop-a",
    stop_name: "Bjorklinge sodra",
    stop_lat: 59.9000,
    stop_lon: 17.7000,
    ...overrides,
  };
}

describe("buildStopGroups", () => {
  it("merges nearby sibling stops into one grouped symbol and unions their routes", () => {
    const northbound = createStop({ stop_id: "stop-a", stop_lat: 59.9000, stop_lon: 17.7000 });
    const southbound = createStop({ stop_id: "stop-b", stop_lat: 59.90055, stop_lon: 17.7001 });
    const distant = createStop({ stop_id: "stop-c", stop_name: "Centralen", stop_lat: 59.905, stop_lon: 17.71 });

    const groups = buildStopGroups(
      [northbound, southbound, distant],
      {
        "stop-a": ["route-1"],
        "stop-b": ["route-2", "route-3"],
        "stop-c": ["route-9"],
      },
    );

    expect(groups).toHaveLength(2);

    const groupedStop = groups.find((group) => group.stops.some((stop) => stop.stop_id === "stop-a"));
    expect(groupedStop?.stops.map((stop) => stop.stop_id)).toEqual(["stop-a", "stop-b"]);
    expect(groupedStop?.routeIds).toEqual(["route-1", "route-2", "route-3"]);
  });

  it("merges nearby related stop-name variants into one visual marker", () => {
    const westbound = createStop({
      stop_id: "stop-a",
      stop_name: "Bjorklinge Ramsjo backe",
      stop_lat: 59.9,
      stop_lon: 17.7,
    });
    const eastbound = createStop({
      stop_id: "stop-b",
      stop_name: "Bjorklinge Ramsjo backe B",
      stop_lat: 59.9002,
      stop_lon: 17.70005,
    });
    const nearbySeparateStop = createStop({
      stop_id: "stop-c",
      stop_name: "Ramsjo backe (Bjorklinge) (Uppsala)",
      stop_lat: 59.9004,
      stop_lon: 17.7001,
    });

    const groups = buildStopGroups([westbound, eastbound, nearbySeparateStop]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.stops.map((stop) => stop.stop_id)).toEqual(["stop-a", "stop-b", "stop-c"]);
  });

  it("finds the matching group for an exact stop id", () => {
    const northbound = createStop({ stop_id: "stop-a" });
    const southbound = createStop({ stop_id: "stop-b", stop_lat: 59.90045, stop_lon: 17.70005 });
    const groups = buildStopGroups([northbound, southbound]);

    const group = findStopGroupForStop(southbound, groups);

    expect(group?.group_id).toBe("stop-a|stop-b");
    expect(group?.stops).toHaveLength(2);
  });

  it("respects stop_id identity and keeps different stop_ids separate", () => {
    const visualGroup = buildStopGroups([
      createStop({ stop_id: "stop-a", stop_name: "Bjorklinge centrum", stop_lat: 59.9, stop_lon: 17.7 }),
      createStop({ stop_id: "stop-b", stop_name: "Bjorklinge centrum", stop_lat: 59.90018, stop_lon: 17.70002 }),
      createStop({ stop_id: "stop-c", stop_name: "Bjorklinge centrum (Uppsala)", stop_lat: 59.90019, stop_lon: 17.70003 }),
    ], {
      "stop-a": ["100"],
      "stop-b": ["161"],
      "stop-c": ["821"],
    })[0];

    const platforms = buildPlatformGroups(visualGroup, {
      "stop-a": ["100"],
      "stop-b": ["161"],
      "stop-c": ["821"],
    });

    expect(platforms).toHaveLength(3);
  });

  it("groups single-word stop names that are nearby and identical", () => {
    const northbound = createStop({ stop_id: "asby-n", stop_name: "Asby", stop_lat: 59.9, stop_lon: 17.7 });
    const southbound = createStop({ stop_id: "asby-s", stop_name: "Asby", stop_lat: 59.9003, stop_lon: 17.70005 });
    const unrelated = createStop({ stop_id: "other", stop_name: "Björklinge", stop_lat: 59.905, stop_lon: 17.71 });

    const groups = buildStopGroups([northbound, southbound, unrelated]);

    expect(groups).toHaveLength(2);
    const asbyGroup = groups.find((g) => g.stop_name === "Asby");
    expect(asbyGroup?.stops).toHaveLength(2);
  });

  it("groups a short name with a longer variant sharing the same base token", () => {
    const a = createStop({ stop_id: "sk-1", stop_name: "Skommarbo", stop_lat: 59.9, stop_lon: 17.7 });
    const b = createStop({ stop_id: "sk-2", stop_name: "Skommarbo station", stop_lat: 59.9002, stop_lon: 17.7001 });
    const c = createStop({ stop_id: "sk-3", stop_name: "Skommarbo", stop_lat: 59.9001, stop_lon: 17.70005 });

    const groups = buildStopGroups([a, b, c]);

    expect(groups).toHaveLength(1);
    expect(groups[0].stops).toHaveLength(3);
  });

  it("merges exact duplicate stop_ids and base-id matches (north/south variants)", () => {
    const visualGroup = buildStopGroups([
      createStop({ stop_id: "stora-vallskog-n", stop_name: "Stora Vallskog", stop_lat: 59.9, stop_lon: 17.7 }),
      createStop({ stop_id: "stora-vallskog-n", stop_name: "Stora Vallskog", stop_lat: 59.90005, stop_lon: 17.70001 }),
      createStop({ stop_id: "stora-vallskog-s", stop_name: "Stora Vallskog", stop_lat: 59.90010, stop_lon: 17.70002 }),
    ], {
      "stora-vallskog-n": ["100"],
      "stora-vallskog-s": ["100"],
    })[0];

    const platforms = buildPlatformGroups(visualGroup, {
      "stora-vallskog-n": ["100"],
      "stora-vallskog-s": ["100"],
    });

    expect(platforms).toHaveLength(2);
    const northPlat = platforms.find((p) => p.stops.some((s) => s.stop_id.includes("north") || s.stop_id.endsWith("-n")));
    expect(northPlat?.stops).toHaveLength(2);
  });

  it("does not merge nearby stops with similar names but disjoint routes", () => {
    const stopA = createStop({
      stop_id: "barby-gatan",
      stop_name: "Uppsala Bärbygatan",
      stop_lat: 59.8700,
      stop_lon: 17.6300,
    });
    const stopB = createStop({
      stop_id: "barby-leden",
      stop_name: "Uppsala Bärbyleden",
      stop_lat: 59.8706,
      stop_lon: 17.6300,
    });

    const groups = buildStopGroups([stopA, stopB], {
      "barby-gatan": ["8"],
      "barby-leden": ["3", "11", "14"],
    });

    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.stops.some((s) => s.stop_id === "barby-gatan"))?.routeIds).toEqual(["8"]);
    expect(groups.find((g) => g.stops.some((s) => s.stop_id === "barby-leden"))?.routeIds).toEqual(["3", "11", "14"]);
  });

  it("still merges nearby stops with disjoint routes when route data is missing", () => {
    const stopA = createStop({
      stop_id: "barby-gatan",
      stop_name: "Uppsala Bärbygatan",
      stop_lat: 59.8700,
      stop_lon: 17.6300,
    });
    const stopB = createStop({
      stop_id: "barby-gatan-s",
      stop_name: "Uppsala Bärbygatan",
      stop_lat: 59.87005,
      stop_lon: 17.63005,
    });

    const groups = buildStopGroups([stopA, stopB], {});

    expect(groups).toHaveLength(1);
  });
});