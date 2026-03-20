import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import protobuf from "npm:protobufjs@7.4.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROTO_DEF = `
syntax = "proto2";
package transit_realtime;

message FeedMessage {
  required FeedHeader header = 1;
  repeated FeedEntity entity = 2;
}
message FeedHeader {
  required string gtfs_realtime_version = 1;
  optional uint64 timestamp = 3;
}
message FeedEntity {
  required string id = 1;
  optional VehiclePosition vehicle = 4;
}
message VehiclePosition {
  optional TripDescriptor trip = 1;
  optional Position position = 2;
  optional uint32 current_stop_sequence = 3;
  optional VehicleStopStatus current_status = 4;
  optional uint64 timestamp = 5;
  optional string stop_id = 7;
  optional VehicleDescriptor vehicle_desc = 8;
}
enum VehicleStopStatus {
  INCOMING_AT = 0;
  STOPPED_AT = 1;
  IN_TRANSIT_TO = 2;
}
message Position {
  required float latitude = 1;
  required float longitude = 2;
  optional float bearing = 3;
  optional float speed = 5;
}
message TripDescriptor {
  optional string trip_id = 1;
  optional string start_time = 2;
  optional string start_date = 3;
  optional string route_id = 5;
  optional uint32 direction_id = 6;
}
message VehicleDescriptor {
  optional string id = 1;
  optional string label = 2;
}
`;

let cachedRoot: protobuf.Root | null = null;

function getRoot() {
  if (!cachedRoot) {
    cachedRoot = protobuf.parse(PROTO_DEF).root;
  }
  return cachedRoot;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("TRAFIKLAB_GTFS_RT_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://opendata.samtrafiken.se/gtfs-rt-sweden/ul/VehiclePositionsSweden.pb?key=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Trafiklab error: ${response.status}` }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const buffer = await response.arrayBuffer();
    const root = getRoot();
    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
    const feed = FeedMessage.decode(new Uint8Array(buffer));
    const feedObj = FeedMessage.toObject(feed, {
      longs: Number,
      defaults: true,
    });

    const vehicles = (feedObj.entity || [])
      .filter(
        (e: any) => e.vehicle && e.vehicle.position
      )
      .map((e: any) => ({
        id: e.id,
        tripId: e.vehicle.trip?.tripId || "",
        routeId: e.vehicle.trip?.routeId || "",
        directionId: e.vehicle.trip?.directionId || 0,
        lat: e.vehicle.position.latitude,
        lon: e.vehicle.position.longitude,
        bearing: e.vehicle.position.bearing || 0,
        speed: e.vehicle.position.speed || 0,
        stopId: e.vehicle.stopId || "",
        currentStopSequence: e.vehicle.currentStopSequence || 0,
        vehicleId: e.vehicle.vehicleDesc?.id || "",
        vehicleLabel: e.vehicle.vehicleDesc?.label || "",
        timestamp: e.vehicle.timestamp || 0,
      }));

    return new Response(
      JSON.stringify({ vehicles, timestamp: feedObj.header?.timestamp }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
