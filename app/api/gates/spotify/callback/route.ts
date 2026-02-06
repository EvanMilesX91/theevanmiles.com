import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!code || !state) {
    return NextResponse.redirect(new URL('/download/error', request.url));
  }

  try {
    const decodedState = JSON.parse(atob(state));
    const { gate_id, email, slug } = decodedState;

    // Exchange code for access token
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/api/gates/spotify/callback`,
      }),
    });

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;

    // Follow artist (Evan Miles Spotify ID: 13cCyqArWrwa6aq9enBy8l)
    await fetch(
      `https://api.spotify.com/v1/me/following?type=artist&ids=13cCyqArWrwa6aq9enBy8l`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    // Update gate completion
    const { data: existing } = await supabaseAdmin!
      .from('gate_completions')
      .select('*')
      .eq('gate_id', gate_id)
      .eq('user_email', email)
      .single();

    if (existing) {
      await supabaseAdmin!
        .from('gate_completions')
        .update({
          completed_actions: {
            ...existing.completed_actions,
            spotify_follow: true,
          },
        })
        .eq('id', existing.id);
    } else {
      await supabaseAdmin!.from('gate_completions').insert({
        gate_id,
        user_email: email,
        completed_actions: { spotify_follow: true },
      });
    }

    return NextResponse.redirect(
      new URL(`/download/${slug}?spotify=success`, request.url)
    );
  } catch (error) {
    console.error('Spotify callback error:', error);
    return NextResponse.redirect(new URL('/download/error', request.url));
  }
}