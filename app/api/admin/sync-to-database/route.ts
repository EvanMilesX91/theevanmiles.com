import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { stems, edits, tunes } = await request.json();

    let tracks_added = 0;
    let stems_added = 0;
    let edits_added = 0;
    let tunes_added = 0;

    // Process stems
    for (const track of stems.tracks) {
      const newFiles = track.files.filter((f: any) => !f.exists_in_db);

      if (newFiles.length === 0) continue;

      // Check if track exists, if not create it
      let { data: existingTrack, error: trackCheckError } = await supabase
        .from('tracks')
        .select('id')
        .eq('slug', track.track_slug)
        .single();

      let trackId: string;

      if (!existingTrack) {
        // Create track
        const { data: newTrack, error: trackCreateError } = await supabase
          .from('tracks')
          .insert({
            name: track.track_name,
            slug: track.track_slug,
          })
          .select()
          .single();

        if (trackCreateError) throw trackCreateError;

        trackId = newTrack.id;
        tracks_added++;
      } else {
        trackId = existingTrack.id;
      }

      // Insert stem files (only if they don't already exist)
      for (const file of newFiles) {
        // Double-check it doesn't exist
        const { data: existing } = await supabase
          .from('stem_files')
          .select('id')
          .eq('file_path', file.path)
          .single();

        if (existing) {
          console.log(`Stem already exists: ${file.path}, skipping`);
          continue;
        }

        const { error: stemError } = await supabase.from('stem_files').insert({
          track_id: trackId,
          filename: file.name,
          file_path: file.path,
          file_size: file.size,
          file_type: file.type,
        });

        if (stemError) {
          console.error('Error inserting stem:', stemError);
        } else {
          stems_added++;
        }
      }
    }

    // Process edits
    const newEdits = edits.filter((f: any) => !f.exists_in_db);

    for (const file of newEdits) {
      // Double-check it doesn't exist
      const { data: existing } = await supabase
        .from('edit_files')
        .select('id')
        .eq('file_path', file.path)
        .eq('bucket', 'edits')
        .single();

      if (existing) {
        console.log(`Edit already exists: ${file.path}, skipping`);
        continue;
      }

      const { error: editError } = await supabase.from('edit_files').insert({
        filename: file.name,
        file_path: file.path,
        file_size: file.size,
        file_type: file.type,
        bucket: 'edits',
      });

      if (editError) {
        console.error('Error inserting edit:', editError);
      } else {
        edits_added++;
      }
    }

    // Process tunes
    const newTunes = tunes.filter((f: any) => !f.exists_in_db);

    for (const file of newTunes) {
      // Double-check it doesn't exist
      const { data: existing } = await supabase
        .from('edit_files')
        .select('id')
        .eq('file_path', file.path)
        .eq('bucket', 'tunes')
        .single();

      if (existing) {
        console.log(`Tune already exists: ${file.path}, skipping`);
        continue;
      }

      const { error: tuneError } = await supabase.from('edit_files').insert({
        filename: file.name,
        file_path: file.path,
        file_size: file.size,
        file_type: file.type,
        bucket: 'tunes',
      });

      if (tuneError) {
        console.error('Error inserting tune:', tuneError);
      } else {
        tunes_added++;
      }
    }

    return NextResponse.json({
      success: true,
      tracks_added,
      stems_added,
      edits_added,
      tunes_added,
    });
  } catch (error: any) {
    console.error('Error syncing to database:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync to database' },
      { status: 500 }
    );
  }
}