import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  try {
    // Fetch all tracks with their stems
    const { data: tracks, error: tracksError } = await supabase
      .from('tracks')
      .select('*')
      .order('created_at', { ascending: false });

    if (tracksError) throw tracksError;

    // Fetch stems for each track
    const tracksWithStems = await Promise.all(
      tracks.map(async (track) => {
        const { data: stems, error: stemsError } = await supabase
          .from('stem_files')
          .select('*')
          .eq('track_id', track.id)
          .order('filename', { ascending: true });

        if (stemsError) throw stemsError;

        return {
          ...track,
          stems: stems || []
        };
      })
    );

    return NextResponse.json(tracksWithStems);
  } catch (error) {
    console.error('Error fetching stems:', error);
    return NextResponse.json({ error: 'Failed to fetch stems' }, { status: 500 });
  }
}