
CREATE TABLE public.stop_times (
  trip_id text NOT NULL,
  stop_id text NOT NULL,
  stop_sequence integer NOT NULL,
  arrival_time text,
  departure_time text,
  PRIMARY KEY (trip_id, stop_sequence)
);

ALTER TABLE public.stop_times ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_stop_times" ON public.stop_times
  FOR SELECT TO public USING (true);

CREATE INDEX idx_stop_times_trip ON public.stop_times(trip_id);
CREATE INDEX idx_stop_times_stop ON public.stop_times(stop_id);

CREATE OR REPLACE FUNCTION public.get_next_stops(p_trip_id text, p_current_seq integer, p_limit integer DEFAULT 5)
RETURNS TABLE(stop_id text, stop_name text, stop_lat double precision, stop_lon double precision, stop_sequence integer, arrival_time text, departure_time text)
LANGUAGE sql STABLE
AS $$
  SELECT st.stop_id, ts.stop_name, ts.stop_lat, ts.stop_lon, st.stop_sequence, st.arrival_time, st.departure_time
  FROM public.stop_times st
  JOIN public.transit_stops ts ON ts.stop_id = st.stop_id
  WHERE st.trip_id = p_trip_id AND st.stop_sequence > p_current_seq
  ORDER BY st.stop_sequence
  LIMIT p_limit;
$$;
