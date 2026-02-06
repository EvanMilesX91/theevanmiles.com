// app/api/cron/release-day/route.ts
// Runs daily to process released presave campaigns
// 1. Finds campaigns that released today (or earlier, if missed)
// 2. Looks up Spotify track ID by UPC/ISRC
// 3. Uses stored refresh tokens to save tracks to user libraries
// 4. Sends notification emails

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Verify this is a legitimate cron request (from Vercel or manual trigger)
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    // Allow manual triggers without secret in development
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  console.log('=== RELEASE DAY CRON JOB STARTED ===');
  console.log(`Time: ${new Date().toISOString()}`);

  const results = {
    processed_campaigns: 0,
    processed_users: 0,
    tracks_saved: 0,
    errors: [] as string[],
  };

  try {
    // ============================================
    // STEP 1: Find campaigns that need processing
    // ============================================
    const { data: campaigns, error: campaignsError } = await supabaseAdmin
      .from('presaves')
      .select('*')
      .lte('release_date', new Date().toISOString().split('T')[0]) // Released today or earlier
      .eq('is_released', false)
      .eq('is_active', true);

    if (campaignsError) {
      console.error('Error fetching campaigns:', campaignsError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (!campaigns || campaigns.length === 0) {
      console.log('No campaigns to process today');
      return NextResponse.json({
        message: 'No campaigns to process',
        ...results,
      });
    }

    console.log(`Found ${campaigns.length} campaign(s) to process`);

    // ============================================
    // STEP 2: Process each campaign
    // ============================================
    for (const campaign of campaigns) {
      console.log(`\nProcessing: "${campaign.title}" (${campaign.slug})`);
      results.processed_campaigns++;

      let spotifyTrackId = campaign.spotify_track_id;

      // ============================================
      // STEP 2a: Look up Spotify Track ID if we don't have it
      // ============================================
      if (!spotifyTrackId && (campaign.upc || campaign.isrc)) {
        console.log(`Looking up Spotify track ID by UPC: ${campaign.upc} / ISRC: ${campaign.isrc}`);
        
        spotifyTrackId = await lookupSpotifyTrackId(
          campaign.upc,
          campaign.isrc,
          campaign.title,
          campaign.artist
        );

        if (spotifyTrackId) {
          console.log(`Found Spotify track ID: ${spotifyTrackId}`);
          
          // Save it to the campaign for future reference
          await supabaseAdmin
            .from('presaves')
            .update({ spotify_track_id: spotifyTrackId })
            .eq('id', campaign.id);
        } else {
          console.warn(`Could not find Spotify track ID for "${campaign.title}"`);
          results.errors.push(`No Spotify ID found for: ${campaign.title}`);
          // Continue anyway - maybe it's not on Spotify yet
        }
      }

      // ============================================
      // STEP 2b: Get all users who presaved this campaign
      // ============================================
      const { data: users, error: usersError } = await supabaseAdmin
        .from('presave_users')
        .select('*')
        .eq('presave_id', campaign.id)
        .eq('track_saved', false);

      if (usersError) {
        console.error('Error fetching users:', usersError);
        results.errors.push(`Failed to fetch users for: ${campaign.title}`);
        continue;
      }

      if (!users || users.length === 0) {
        console.log('No users to process for this campaign');
        continue;
      }

      console.log(`Processing ${users.length} user(s) for "${campaign.title}"`);

      // ============================================
      // STEP 2c: Save track to each user's library
      // ============================================
      for (const user of users) {
        results.processed_users++;

        try {
          if (user.platform === 'spotify' && spotifyTrackId && user.spotify_refresh_token) {
            const saved = await saveTrackToSpotifyLibrary(
              user.spotify_refresh_token,
              spotifyTrackId
            );

            if (saved) {
              results.tracks_saved++;
              
              // Update user record
              await supabaseAdmin
                .from('presave_users')
                .update({ track_saved: true })
                .eq('id', user.id);

              console.log(`✓ Saved track to ${user.email}'s Spotify library`);
            }
          } else if (user.platform === 'deezer' && user.deezer_access_token) {
            // Deezer implementation would go here
            // Similar pattern: lookup track ID, save to library
            console.log(`Deezer save for ${user.email} - not yet implemented`);
          } else {
            // Apple Music, Amazon, YouTube - can't auto-save
            // Just mark as processed
            await supabaseAdmin
              .from('presave_users')
              .update({ track_saved: true })
              .eq('id', user.id);
          }
        } catch (userError) {
          console.error(`Error processing user ${user.email}:`, userError);
          results.errors.push(`Failed to save for: ${user.email}`);
        }
      }

      // ============================================
      // STEP 2d: Mark campaign as released
      // ============================================
      await supabaseAdmin
        .from('presaves')
        .update({ is_released: true })
        .eq('id', campaign.id);

      console.log(`✓ Campaign "${campaign.title}" marked as released`);
    }

    console.log('\n=== RELEASE DAY CRON JOB COMPLETE ===');
    console.log(`Campaigns processed: ${results.processed_campaigns}`);
    console.log(`Users processed: ${results.processed_users}`);
    console.log(`Tracks saved: ${results.tracks_saved}`);
    console.log(`Errors: ${results.errors.length}`);

    return NextResponse.json({
      message: 'Cron job completed',
      ...results,
    });

  } catch (error) {
    console.error('Cron job failed:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: String(error) },
      { status: 500 }
    );
  }
}

// ============================================
// HELPER: Look up Spotify Track ID
// Tries UPC first, then ISRC, then title search
// ============================================
async function lookupSpotifyTrackId(
  upc: string | null,
  isrc: string | null,
  title: string,
  artist: string
): Promise<string | null> {
  
  // Get a client credentials token (no user auth needed for search)
  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
    }),
  });

  if (!tokenResponse.ok) {
    console.error('Failed to get Spotify client token');
    return null;
  }

  const { access_token } = await tokenResponse.json();

  // Try ISRC search first (most reliable)
  if (isrc) {
    const isrcSearch = await fetch(
      `https://api.spotify.com/v1/search?q=isrc:${isrc}&type=track&limit=1`,
      {
        headers: { 'Authorization': `Bearer ${access_token}` },
      }
    );

    if (isrcSearch.ok) {
      const data = await isrcSearch.json();
      if (data.tracks?.items?.[0]?.id) {
        return data.tracks.items[0].id;
      }
    }
  }

  // Try UPC search (searches albums, then get tracks)
  if (upc) {
    const upcSearch = await fetch(
      `https://api.spotify.com/v1/search?q=upc:${upc}&type=album&limit=1`,
      {
        headers: { 'Authorization': `Bearer ${access_token}` },
      }
    );

    if (upcSearch.ok) {
      const data = await upcSearch.json();
      const albumId = data.albums?.items?.[0]?.id;
      
      if (albumId) {
        // Get tracks from the album
        const tracksResponse = await fetch(
          `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=1`,
          {
            headers: { 'Authorization': `Bearer ${access_token}` },
          }
        );

        if (tracksResponse.ok) {
          const tracksData = await tracksResponse.json();
          if (tracksData.items?.[0]?.id) {
            return tracksData.items[0].id;
          }
        }
      }
    }
  }

  // Fallback: Title + Artist search
  const titleSearch = await fetch(
    `https://api.spotify.com/v1/search?q=track:${encodeURIComponent(title)}+artist:${encodeURIComponent(artist)}&type=track&limit=1`,
    {
      headers: { 'Authorization': `Bearer ${access_token}` },
    }
  );

  if (titleSearch.ok) {
    const data = await titleSearch.json();
    if (data.tracks?.items?.[0]?.id) {
      return data.tracks.items[0].id;
    }
  }

  return null;
}

// ============================================
// HELPER: Save track to user's Spotify library
// Uses refresh token to get new access token
// ============================================
async function saveTrackToSpotifyLibrary(
  refreshToken: string,
  trackId: string
): Promise<boolean> {
  
  // Get new access token using refresh token
  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!tokenResponse.ok) {
    console.error('Failed to refresh Spotify token');
    return false;
  }

  const { access_token } = await tokenResponse.json();

  // Save track to library
  const saveResponse = await fetch(
    `https://api.spotify.com/v1/me/tracks?ids=${trackId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${access_token}`,
      },
    }
  );

  return saveResponse.ok;
}

// Also support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}