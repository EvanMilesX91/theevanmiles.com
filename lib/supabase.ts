import { createClient } from '@supabase/supabase-js';

// Check if environment variables exist
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
}

if (!supabaseAnonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable');
}

// Client for browser (public operations) - USE THIS IN YOUR PAGES
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side client with service role for admin operations
// Only available on server-side (API routes, server components)
// DO NOT import this in client components
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// Helper to get admin client with proper error handling
export function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client is only available on the server. Use the regular "supabase" client for client-side operations.');
  }
  return supabaseAdmin;
}