create table if not exists public.fpl_dashboard_snapshots (
  id text primary key check (id = 'latest'),
  generated_at timestamptz not null,
  refreshed_at timestamptz not null,
  trigger text not null check (trigger in ('scheduled', 'manual', 'bootstrap')),
  duration_ms integer not null check (duration_ms >= 0),
  checksum text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.fpl_dashboard_snapshots enable row level security;

revoke all on table public.fpl_dashboard_snapshots from anon, authenticated;

comment on table public.fpl_dashboard_snapshots is
  'Server-only latest precomputed FPL decision snapshot. Browser access is through /api/fpl/phase-six.';
