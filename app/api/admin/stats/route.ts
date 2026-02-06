import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Get total tracks
    const { count: tracksCount, error: tracksError } = await supabase
      .from('tracks')
      .select('*', { count: 'exact', head: true });

    if (tracksError) throw tracksError;

    // Get total edits
    const { count: editsCount, error: editsError } = await supabase
      .from('edit_files')
      .select('*', { count: 'exact', head: true })
      .eq('bucket', 'edits');

    if (editsError) throw editsError;

    // Get total tunes
    const { count: tunesCount, error: tunesError } = await supabase
      .from('edit_files')
      .select('*', { count: 'exact', head: true })
      .eq('bucket', 'tunes');

    if (tunesError) {
      console.error('Tunes count error:', tunesError);
    }

    // Get email subscribers from file
    let emailCount = 0;
    try {
      const filePath = path.join(process.cwd(), 'mailinglist-signup.txt');
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const lines = fileContent.split('\n').filter(line => line.trim() !== '');
      emailCount = lines.length;
    } catch (fileError) {
      console.log('mailinglist-signup.txt not found, using count 0');
    }

    // Get total presaves (if presaves table exists)
    const { count: presavesCount, error: presavesError } = await supabase
      .from('presaves')
      .select('*', { count: 'exact', head: true });

    if (presavesError && presavesError.code !== 'PGRST116') {
      console.error('Presaves count error:', presavesError);
    }

    // Get total gates (if gates table exists)
    const { count: gatesCount, error: gatesError } = await supabase
      .from('gates')
      .select('*', { count: 'exact', head: true });

    if (gatesError && gatesError.code !== 'PGRST116') {
      console.error('Gates count error:', gatesError);
    }

    // Get total downloads
    const { count: downloadsCount, error: downloadsError } = await supabase
      .from('download_stats')
      .select('*', { count: 'exact', head: true });

    if (downloadsError) throw downloadsError;

    console.log('Stats Debug:', {
      tracks: tracksCount,
      edits: editsCount,
      tunes: tunesCount,
      emails: emailCount
    });

    return NextResponse.json({
      totalTracks: tracksCount || 0,
      totalEdits: editsCount || 0,
      totalTunes: tunesCount || 0,
      emailSubscribers: emailCount,
      totalPresaves: presavesCount || 0,
      totalGates: gatesCount || 0,
      totalDownloads: downloadsCount || 0,
    });
  } catch (error: any) {
    console.error('Error fetching admin stats:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}