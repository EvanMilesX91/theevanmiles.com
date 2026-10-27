create table if not exists public.fpl_projection_calibration (
  gameweek integer primary key check (gameweek between 1 and 38),
  captured_at timestamptz not null,
  evaluated_at timestamptz,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.fpl_projection_calibration enable row level security;

revoke all on table public.fpl_projection_calibration from anon, authenticated;

comment on table public.fpl_projection_calibration is
  'Server-only frozen FPL forecasts and post-Gameweek accuracy measurements.';
