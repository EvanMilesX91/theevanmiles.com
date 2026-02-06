import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    console.log('=== SCAN STORAGE (Using RPC) ===');
    
    // Call RPC functions to get files from each bucket
    const [stemsResult, editsResult, tunesResult] = await Promise.all([
      supabase.rpc('get_storage_files', { bucket_name: 'stems' }),
      supabase.rpc('get_storage_files', { bucket_name: 'edits' }),
      supabase.rpc('get_storage_files', { bucket_name: 'tunes' })
    ]);

    if (stemsResult.error) {
      console.error('Stems RPC error:', stemsResult.error);
      throw stemsResult.error;
    }
    if (editsResult.error) {
      console.error('Edits RPC error:', editsResult.error);
      throw editsResult.error;
    }
    if (tunesResult.error) {
      console.error('Tunes RPC error:', tunesResult.error);
      throw tunesResult.error;
    }

    const stemsFiles = stemsResult.data || [];
    const editsFiles = editsResult.data || [];
    const tunesFiles = tunesResult.data || [];

    console.log(`Found files - Stems: ${stemsFiles.length}, Edits: ${editsFiles.length}, Tunes: ${tunesFiles.length}`);
    console.log('Edits files:', editsFiles.map(f => f.name));

    interface StorageFile {
      name: string;
      metadata?: {
        size: number;
      };
    }

    interface TrackFile {
      name: string;
      size: number;
      path: string;
      type: string;
      bucket: string;
      exists_in_db: boolean;
    }

    interface Track {
      track_name: string;
      track_slug: string;
      files: TrackFile[];
    }

    interface StorageResponse {
      stems: {
        tracks: Track[];
      };
      edits: TrackFile[];
      tunes: TrackFile[];
    }

    // Get existing data from database
    const { data: existingTracks } = await supabase.from('tracks').select('slug');
    const { data: existingStems } = await supabase.from('stem_files').select('file_path');
    const { data: existingEdits } = await supabase.from('edit_files').select('file_path, bucket');

    // Create sets for fast lookup
    const existingTrackSlugs = new Set(existingTracks?.map((t) => t.slug) || []);
    const existingStemPaths = new Set(existingStems?.map((s) => s.file_path) || []);
    const existingEditPaths = new Set(
      existingEdits?.map((e) => `${e.bucket}:${e.file_path}`) || []
    );

    // Process stems - group by folder (track)
    const trackMap = new Map<string, any[]>();

    for (const file of stemsFiles) {
      if (!file.name.includes('.')) continue; // Skip folders

      const parts = file.name.split('/');
      let trackName: string;
      let filename: string;
      let filePath: string;

      if (parts.length > 1) {
        trackName = parts[0];
        filename = parts.slice(1).join('/');
        filePath = file.name;
      } else {
        trackName = 'Untitled';
        filename = file.name;
        filePath = file.name;
      }

      const fileType = filename.split('.').pop()?.toLowerCase() || 'unknown';
      const fileSize = file.metadata?.size || 0;

      if (!trackMap.has(trackName)) {
        trackMap.set(trackName, []);
      }

      trackMap.get(trackName)!.push({
        name: filename,
        size: fileSize,
        path: filePath,
        type: fileType,
        bucket: 'stems',
        exists_in_db: existingStemPaths.has(filePath),
      });
    }

    // Convert track map to array
    const tracks = Array.from(trackMap.entries()).map(([trackName, files]) => {
      const slug = trackName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      return {
        track_name: trackName
          .split('-')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' '),
        track_slug: slug,
        files,
      };
    });

    // Process edits
    const edits = editsFiles
      .filter((file) => file.name.includes('.'))
      .map((file) => {
        const fileType = file.name.split('.').pop()?.toLowerCase() || 'unknown';
        const fileSize = file.metadata?.size || 0;
        const existsCheck = existingEditPaths.has(`edits:${file.name}`);
        
        return {
          name: file.name,
          size: fileSize,
          path: file.name,
          type: fileType,
          bucket: 'edits',
          exists_in_db: existsCheck,
        };
      });

    // Process tunes
    const tunes = tunesFiles
      .filter((file) => file.name.includes('.'))
      .map((file) => {
        const fileType = file.name.split('.').pop()?.toLowerCase() || 'unknown';
        const fileSize = file.metadata?.size || 0;
        
        return {
          name: file.name,
          size: fileSize,
          path: file.name,
          type: fileType,
          bucket: 'tunes',
          exists_in_db: existingEditPaths.has(`tunes:${file.name}`),
        };
      });

    console.log('=== SCAN COMPLETE ===');
    console.log(`Tracks: ${tracks.length}, Edits: ${edits.length}, Tunes: ${tunes.length}`);

    return NextResponse.json({
      stems: { tracks },
      edits,
      tunes,
    });
  } catch (error: any) {
    console.error('Error scanning storage:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to scan storage' },
      { status: 500 }
    );
  }
}