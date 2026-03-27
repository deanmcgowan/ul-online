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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const clientHash = body.hash || "";
    const dataset = body.dataset || "all";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Quick hash check from metadata table — no need to fetch all data
    if (clientHash && dataset === "all") {
      const { data: meta } = await supabase
        .from("static_data_meta")
        .select("value")
        .eq("key", "combined_hash")
        .single();

      if (meta?.value && meta.value === clientHash) {
        return new Response(
          JSON.stringify({ unchanged: true, hash: clientHash }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fetch only requested dataset
    const results: Record<string, any> = {};

    if (dataset === "all" || dataset === "stops") {
      results.stops = await fetchAll(supabase, "transit_stops");
    }
    if (dataset === "all" || dataset === "routes") {
      results.routes = await fetchAll(supabase, "transit_routes");
    }
    if (dataset === "all" || dataset === "stopRoutes") {
      results.stopRoutes = await fetchAll(supabase, "stop_routes");
    }

    // Get current hash from meta
    const { data: hashMeta } = await supabase
      .from("static_data_meta")
      .select("value")
      .eq("key", "combined_hash")
      .single();

    const currentHash = hashMeta?.value || "initial";

    return new Response(
      JSON.stringify({
        unchanged: false,
        hash: currentHash,
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
