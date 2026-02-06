// app/api/admin/create-presave/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service role key for admin operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export async function POST(request: NextRequest) {
  try {
    // Check admin auth
    const adminAuth = request.headers.get('x-admin-auth');
    if (adminAuth !== 'authenticated') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      slug,
      upc,
      spotify_id,
      apple_music_id,
      title,
      artist,
      release_date,
      cover_url,
      headline,
      email_template,
    } = body;

    // Validate required fields
    if (!slug || !title || !artist || !release_date || !cover_url) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Insert presave using admin client
    const { data, error } = await supabaseAdmin
      .from('presaves')
      .insert({
        slug,
        upc,
        spotify_id,
        apple_music_id,
        title,
        artist,
        release_date,
        cover_url,
        headline,
        email_template,
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('Server error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}