
CREATE OR REPLACE FUNCTION public.get_next_stops(p_trip_id text, p_current_seq integer, p_limit integer DEFAULT 5)
RETURNS TABLE(stop_id text, stop_name text, stop_lat double precision, stop_lon double precision, stop_sequence integer, arrival_time text, departure_time text)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT st.stop_id, ts.stop_name, ts.stop_lat, ts.stop_lon, st.stop_sequence, st.arrival_time, st.departure_time
  FROM public.stop_times st
  JOIN public.transit_stops ts ON ts.stop_id = st.stop_id
  WHERE st.trip_id = p_trip_id AND st.stop_sequence > p_current_seq
  ORDER BY st.stop_sequence
  LIMIT p_limit;
$$;
