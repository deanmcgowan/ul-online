CREATE TABLE public.static_data_meta (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.static_data_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON public.static_data_meta
  FOR SELECT TO anon, authenticated USING (true);