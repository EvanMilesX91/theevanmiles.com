import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  try {
    const { data: files, error } = await supabase
      .from('edit_files')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(files || []);
  } catch (error) {
    console.error('Error fetching edits:', error);
    return NextResponse.json({ error: 'Failed to fetch edits' }, { status: 500 });
  }
}