import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { file_type, file_id } = await request.json();

    if (!file_type || !file_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';

    // Record the download
    const { error } = await supabase
      .from('download_stats')
      .insert({
        file_type,
        file_id,
        ip_address: ip,
      });

    if (error) {
      console.error('Error tracking download:', error);
      return NextResponse.json({ error: 'Failed to track download' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Download tracking error:', error);
    return NextResponse.json({ error: 'Failed to track download' }, { status: 500 });
  }
}