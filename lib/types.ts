// lib/types.ts
// TypeScript types for the entire application

// ============================================
// PRESAVE SYSTEM TYPES
// ============================================

export interface Presave {
  id: string;
  slug: string;
  title: string;
  artist: string;
  release_date: string;
  cover_url?: string;
  headline?: string;
  email_template?: string;
  
  // Identifiers
  upc?: string;
  isrc?: string;
  
  // Platform-specific IDs (filled after release)
  spotify_track_id?: string;
  apple_music_id?: string;
  deezer_track_id?: string;
  
  // Redirect URL after successful presave
  success_redirect_url?: string;
  
  // Status
  is_active: boolean;
  is_released: boolean;
  
  created_at: string;
  updated_at: string;
}

export type PresavePlatform = 'spotify' | 'apple' | 'deezer' | 'amazon' | 'youtube';

export interface PresaveUser {
  id: string;
  presave_id: string;
  email: string;
  platform: PresavePlatform;
  
  // Spotify OAuth tokens
  spotify_user_id?: string;
  spotify_access_token?: string;
  spotify_refresh_token?: string;
  spotify_token_expires_at?: string;
  
  // Deezer OAuth
  deezer_user_id?: string;
  deezer_access_token?: string;
  
  // Status tracking
  followed_artist: boolean;
  track_saved: boolean;
  email_sent: boolean;
  
  created_at: string;
  updated_at: string;
}

// ============================================
// DOWNLOAD GATE TYPES
// ============================================

export interface Gate {
  id: string;
  slug: string;
  title: string;
  file_url: string;
  cover_url?: string;
  requirements: {
    spotify_follow?: boolean;
    email?: boolean;
    instagram?: boolean;
    presave?: boolean;
  };
  success_message: string;
  created_at: string;
}

export interface GateCompletion {
  id: string;
  gate_id: string;
  user_email?: string;
  completed_actions: {
    spotify_follow?: boolean;
    email?: boolean;
    instagram?: boolean;
    presave?: boolean;
  };
  unlocked: boolean;
  created_at: string;
}

// ============================================
// SHOWS & MIXES TYPES
// ============================================

export interface Show {
  id: string;
  date: string;
  venue: string;
  city: string;
  country?: string;
  poster_url?: string;
  video_url?: string;
  status: 'upcoming' | 'past';
  created_at: string;
}

export interface Mix {
  id: string;
  title: string;
  description?: string;
  tracklist?: string;
  cover_url?: string;
  audio_url: string;
  release_date: string;
  download_gated: boolean;
  created_at: string;
}

// ============================================
// EMAIL LIST TYPES
// ============================================

export interface EmailSubscriber {
  id: string;
  email: string;
  source: string;
  subscribed: boolean;
  created_at: string;
}

// ============================================
// DOWNLOAD FILES TYPES
// ============================================

export interface StemFile {
  id: string;
  track_id: string;
  filename: string;
  file_path: string;
  file_size: number;
  file_type: string;
  created_at: string;
}

export interface EditFile {
  id: string;
  filename: string;
  file_path: string;
  file_size: number;
  file_type: string;
  bucket: 'edits' | 'tunes';
  created_at: string;
}

export interface Track {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface CronJobResult {
  processed_campaigns: number;
  processed_users: number;
  tracks_saved: number;
  errors: string[];
}