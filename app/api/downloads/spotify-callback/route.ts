import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const encodedState = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/downloads?error=spotify_denied`);
    }

    if (!code || !encodedState) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/downloads?error=invalid_callback`);
    }

    // Decode state
    const stateData = JSON.parse(Buffer.from(encodedState, 'base64url').toString());
    const { item_id, item_type, code_verifier } = stateData;

    // Exchange code for access token using PKCE
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.SPOTIFY_CLIENT_ID!,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/downloads/spotify-callback`,
        code_verifier,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Check if user follows Evan Miles on Spotify
    const artistId = '13cCyqArWrwa6aq9enBy8l'; // Your Spotify artist ID
    const followResponse = await fetch(
      `https://api.spotify.com/v1/me/following/contains?type=artist&ids=${artistId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!followResponse.ok) {
      throw new Error('Failed to check follow status');
    }

    const followData = await followResponse.json();
    const isFollowing = followData[0]; // Returns [true] or [false]

    if (!isFollowing) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/downloads?error=not_following`);
    }

    // User is following! Record the unlock
    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';

    const { error: insertError } = await supabase
      .from('download_unlocks')
      .insert({
        item_id,
        item_type,
        unlock_method: 'spotify',
        ip_address: ip,
      });

    if (insertError) {
      console.error('Error recording unlock:', insertError);
    }

    // Redirect back to downloads page with success
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/downloads?unlocked=${item_id}`);
  } catch (error) {
    console.error('Spotify callback error:', error);
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_BASE_URL}/downloads?error=spotify_error`);
  }
}