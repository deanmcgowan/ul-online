import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchAll(supabase: any, table: string) {
  const all: any[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const clientHash = url.searchParams.get("hash") || "";
    const dataset = url.searchParams.get("dataset") || "all"; // stops, routes, stopRoutes, all

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const results: Record<string, any> = {};
    const hashes: Record<string, string> = {};

    if (dataset === "all" || dataset === "stops") {
      const stops = await fetchAll(supabase, "transit_stops");
      const h = simpleHash(JSON.stringify(stops));
      hashes.stops = h;
      results.stops = stops;
    }
    if (dataset === "all" || dataset === "routes") {
      const routes = await fetchAll(supabase, "transit_routes");
      const h = simpleHash(JSON.stringify(routes));
      hashes.routes = h;
      results.routes = routes;
    }
    if (dataset === "all" || dataset === "stopRoutes") {
      const stopRoutes = await fetchAll(supabase, "stop_routes");
      const h = simpleHash(JSON.stringify(stopRoutes));
      hashes.stopRoutes = h;
      results.stopRoutes = stopRoutes;
    }

    // Combine all hashes into one
    const combinedHash = simpleHash(Object.values(hashes).join(","));

    // If client already has this data, return 304-like response
    if (clientHash && clientHash === combinedHash) {
      return new Response(
        JSON.stringify({ unchanged: true, hash: combinedHash }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        unchanged: false,
        hash: combinedHash,
        ...results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
