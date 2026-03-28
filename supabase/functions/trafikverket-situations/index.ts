import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TRAFIKVERKET_ENDPOINT = "https://api.trafikinfo.trafikverket.se/v2/data.json";
const DEFAULT_RADIUS_METERS = 5000;
const DEFAULT_LIMIT = 8;

interface TrafikverketSituationDeviation {
  Header?: string;
  MessageType?: string;
  LocationDescriptor?: string;
  RoadName?: string;
  RoadNumber?: string;
  StartTime?: string;
  EndTime?: string;
  ValidUntilFurtherNotice?: boolean;
  WebLink?: string;
  Geometry?: {
    WGS84?: string;
  };
}

interface TrafikverketSituation {
  Id?: string;
  Deviation?: TrafikverketSituationDeviation[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseWgs84Point(point: string | undefined) {
  if (!point) {
    return null;
  }

  const match = /^POINT\s*\(([-\d.]+)\s+([-\d.]+)\)$/.exec(point.trim());
  if (!match) {
    return null;
  }

  return {
    lon: Number(match[1]),
    lat: Number(match[2]),
  };
}

function haversineDistanceMeters(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
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

function getMessageTypePriority(messageType: string | undefined) {
  switch (messageType) {
    case "Olycka":
      return 4;
    case "Vägarbete":
      return 3;
    case "Restriktion":
      return 2;
    case "Trafikmeddelande":
      return 1;
    default:
      return 0;
  }
}

function buildRequestXml(apiKey: string, lon: number, lat: number, radiusMeters: number, limit: number) {
  return `
<REQUEST>
  <LOGIN authenticationkey="${apiKey}" />
  <QUERY objecttype="Situation" namespace="Road.TrafficInfo" schemaversion="1.6" limit="${limit}">
    <FILTER>
      <NEAR name="Deviation.Geometry.WGS84" value="${lon} ${lat}" mindistance="0" maxdistance="${radiusMeters}" />
    </FILTER>
    <INCLUDE>Id</INCLUDE>
    <INCLUDE>Deviation.Header</INCLUDE>
    <INCLUDE>Deviation.MessageType</INCLUDE>
    <INCLUDE>Deviation.LocationDescriptor</INCLUDE>
    <INCLUDE>Deviation.RoadName</INCLUDE>
    <INCLUDE>Deviation.RoadNumber</INCLUDE>
    <INCLUDE>Deviation.StartTime</INCLUDE>
    <INCLUDE>Deviation.EndTime</INCLUDE>
    <INCLUDE>Deviation.ValidUntilFurtherNotice</INCLUDE>
    <INCLUDE>Deviation.WebLink</INCLUDE>
    <INCLUDE>Deviation.Geometry.WGS84</INCLUDE>
  </QUERY>
</REQUEST>`.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("TRAFIKVERKET_OPEN_DATA_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Trafikverket API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const lat = clamp(Number(body.lat ?? 59.8586), -90, 90);
    const lon = clamp(Number(body.lon ?? 17.6389), -180, 180);
    const radiusMeters = clamp(Number(body.radiusMeters ?? DEFAULT_RADIUS_METERS), 1000, 20000);
    const limit = clamp(Number(body.limit ?? DEFAULT_LIMIT), 1, 20);

    const response = await fetch(TRAFIKVERKET_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
      },
      body: buildRequestXml(apiKey, lon, lat, radiusMeters, limit),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Trafikverket API error: ${response.status}` }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = (await response.json()) as {
      RESPONSE?: {
        RESULT?: Array<{
          Situation?: TrafikverketSituation[];
        }>;
      };
    };

    const groupedSituations = new Map<string, {
      id: string;
      header: string;
      messageType: string;
      locationDescriptor: string;
      roadName: string;
      roadNumber: string;
      startTime: string;
      endTime: string;
      validUntilFurtherNotice: boolean;
      webLink: string;
      lon: number;
      lat: number;
      distanceMeters: number;
    }>();

    const situations = payload.RESPONSE?.RESULT?.flatMap((result) => result.Situation ?? []) ?? [];

    for (const situation of situations) {
      for (const deviation of situation.Deviation ?? []) {
        const point = parseWgs84Point(deviation.Geometry?.WGS84);
        if (!point) {
          continue;
        }

        const distanceMeters = Math.round(haversineDistanceMeters(lat, lon, point.lat, point.lon));
        const entryKey = [
          situation.Id ?? "unknown",
          deviation.LocationDescriptor ?? "",
          `${point.lon},${point.lat}`,
        ].join("|");

        const nextEntry = {
          id: situation.Id ?? crypto.randomUUID(),
          header: deviation.Header ?? deviation.MessageType ?? "Trafikverket",
          messageType: deviation.MessageType ?? "Trafikmeddelande",
          locationDescriptor: deviation.LocationDescriptor ?? "",
          roadName: deviation.RoadName ?? "",
          roadNumber: deviation.RoadNumber ?? "",
          startTime: deviation.StartTime ?? "",
          endTime: deviation.EndTime ?? "",
          validUntilFurtherNotice: deviation.ValidUntilFurtherNotice ?? false,
          webLink: deviation.WebLink ?? "",
          lon: point.lon,
          lat: point.lat,
          distanceMeters,
        };

        const currentEntry = groupedSituations.get(entryKey);
        if (!currentEntry || getMessageTypePriority(nextEntry.messageType) > getMessageTypePriority(currentEntry.messageType)) {
          groupedSituations.set(entryKey, nextEntry);
        }
      }
    }

    const sortedSituations = Array.from(groupedSituations.values())
      .sort((left, right) => {
        if (left.distanceMeters !== right.distanceMeters) {
          return left.distanceMeters - right.distanceMeters;
        }

        return (left.startTime || "").localeCompare(right.startTime || "");
      })
      .slice(0, limit);

    return new Response(JSON.stringify({ situations: sortedSituations, fetchedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});