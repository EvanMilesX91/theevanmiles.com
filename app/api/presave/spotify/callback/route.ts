// app/api/presave/spotify/callback/route.ts
// Handles Spotify OAuth callback for presave system
// Exchanges code for tokens, follows artist, stores refresh token for release day

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service role for database operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Your Spotify Artist ID
const SPOTIFY_ARTIST_ID = '13cCyqArWrwa6aq9enBy8l';

// Default redirect playlist after successful presave
const DEFAULT_SUCCESS_PLAYLIST = 'https://open.spotify.com/playlist/4EmLafS7dzkFcq7aKe3pvM';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Handle user denying authorization
  if (error) {
    console.error('Spotify auth denied:', error);
    return NextResponse.redirect(
      new URL('/presave/error?reason=denied', request.url)
    );
  }

  if (!code || !state) {
    console.error('Missing code or state');
    return NextResponse.redirect(
      new URL('/presave/error?reason=missing_params', request.url)
    );
  }

  try {
    // Decode state to get presave info
    const decodedState = JSON.parse(atob(state));
    const { presave_id, email, slug } = decodedState;

    console.log(`Processing Spotify presave for ${email}, campaign: ${slug}`);

    // ============================================
    // STEP 1: Exchange code for tokens
    // ============================================
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/api/presave/spotify/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      return NextResponse.redirect(
        new URL('/presave/error?reason=token_failed', request.url)
      );
    }

    const tokens = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokens;

    // Calculate token expiration time
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // ============================================
    // STEP 2: Get user's Spotify profile
    // ============================================
    const profileResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${access_token}`,
      },
    });

    let spotifyUserId = null;
    if (profileResponse.ok) {
      const profile = await profileResponse.json();
      spotifyUserId = profile.id;
      console.log(`Spotify user ID: ${spotifyUserId}`);
    }

    // ============================================
    // STEP 3: Follow artist (Evan Miles)
    // ============================================
    const followResponse = await fetch(
      `https://api.spotify.com/v1/me/following?type=artist&ids=${SPOTIFY_ARTIST_ID}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${access_token}`,
        },
      }
    );

    const followedArtist = followResponse.ok;
    if (followedArtist) {
      console.log(`User ${email} now following Evan Miles on Spotify`);
    } else {
      console.warn('Failed to follow artist, but continuing...');
    }

    // ============================================
    // STEP 4: Check if track is already released
    // If yes, save it immediately. If no, store tokens for later.
    // ============================================
    const { data: presave } = await supabaseAdmin
      .from('presaves')
      .select('spotify_track_id, is_released, success_redirect_url')
      .eq('id', presave_id)
      .single();

    let trackSaved = false;

    // If track is already released and we have the Spotify ID, save it now
    if (presave?.is_released && presave?.spotify_track_id) {
      const saveResponse = await fetch(
        `https://api.spotify.com/v1/me/tracks?ids=${presave.spotify_track_id}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${access_token}`,
          },
        }
      );
      trackSaved = saveResponse.ok;
      if (trackSaved) {
        console.log(`Track ${presave.spotify_track_id} saved to user's library`);
      }
    }

    // ============================================
    // STEP 5: Store presave user with tokens
    // ============================================
    const { error: upsertError } = await supabaseAdmin
      .from('presave_users')
      .upsert({
        presave_id,
        email,
        platform: 'spotify',
        spotify_user_id: spotifyUserId,
        spotify_access_token: access_token,
        spotify_refresh_token: refresh_token,  // CRUCIAL: needed for release day
        spotify_token_expires_at: expiresAt.toISOString(),
        followed_artist: followedArtist,
        track_saved: trackSaved,
      }, {
        onConflict: 'presave_id,email,platform',
        ignoreDuplicates: false,
      });

    if (upsertError) {
      console.error('Failed to store presave user:', upsertError);
      // Don't fail the whole flow, user still presaved
    }

    // ============================================
    // STEP 6: Also add to master email list
    // ============================================
    await supabaseAdmin
      .from('email_list')
      .upsert({
        email,
        source: `presave_${slug}`,
      }, {
        onConflict: 'email',
        ignoreDuplicates: true,
      });

    // ============================================
    // STEP 7: Redirect to success
    // ============================================
    const successUrl = presave?.success_redirect_url || DEFAULT_SUCCESS_PLAYLIST;
    
    // First show success page, then redirect to playlist
    const successPageUrl = new URL(`/presave/${slug}/success`, request.url);
    successPageUrl.searchParams.set('redirect', successUrl);
    successPageUrl.searchParams.set('platform', 'spotify');

    return NextResponse.redirect(successPageUrl);

  } catch (error) {
    console.error('Spotify callback error:', error);
    return NextResponse.redirect(
      new URL('/presave/error?reason=unknown', request.url)
    );
  }
}