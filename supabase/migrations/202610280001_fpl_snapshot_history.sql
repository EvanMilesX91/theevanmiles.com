alter table public.fpl_dashboard_snapshots
  drop constraint if exists fpl_dashboard_snapshots_id_check;

comment on table public.fpl_dashboard_snapshots is
  'Server-only FPL dashboard snapshots. The latest row is mutable; history:* rows are immutable refresh evidence.';
