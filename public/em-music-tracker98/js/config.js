/* ============================================================================
   config.js — Supabase connection for cross-device sync.
   These two values are the PUBLIC url + anon key (safe to ship in client code;
   the anon key only works through Row-Level Security, which scopes every row to
   the signed-in user). Same project as the ONWARD app.
   ========================================================================== */
window.EM_CONFIG = {
  SUPABASE_URL: 'https://psqxonnmktwlfijaeiza.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzcXhvbm5ta3R3bGZpamFlaXphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NDM3ODYsImV4cCI6MjEwMDQxOTc4Nn0.yjUwIZCOu_ELDdbrGW6Z72PKPe7TWz0G_3bXjB6y-KE',
};
