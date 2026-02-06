import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Generate code verifier and challenge for PKCE
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string) {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

export async function POST(request: NextRequest) {
  try {
    const { item_id, item_type } = await request.json();

    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    // Store PKCE verifier and state in session (you'll need to implement session storage)
    // For now, we'll pass it through the state parameter (not ideal for production)
    const stateData = {
      state,
      item_id,
      item_type,
      code_verifier: codeVerifier
    };

    const encodedState = Buffer.from(JSON.stringify(stateData)).toString('base64url');

    // Spotify OAuth parameters
    const params = new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/downloads/spotify-callback`,
      state: encodedState,
      scope: 'user-follow-read', // Permission to check if user follows you
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    });

    const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error('Error generating Spotify auth URL:', error);
    return NextResponse.json({ error: 'Failed to initialize Spotify auth' }, { status: 500 });
  }
}