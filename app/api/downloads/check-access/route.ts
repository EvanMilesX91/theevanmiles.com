import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { item_id } = await request.json();

    // Get user's IP for tracking
    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';

    // Check if this IP has already unlocked this item
    const { data: existingUnlock, error } = await supabase
      .from('download_unlocks')
      .select('*')
      .eq('item_id', item_id)
      .eq('ip_address', ip)
      .single();

    if (existingUnlock) {
      return NextResponse.json({ hasAccess: true, method: existingUnlock.unlock_method });
    }

    return NextResponse.json({ hasAccess: false });
  } catch (error) {
    console.error('Error checking access:', error);
    return NextResponse.json({ hasAccess: false });
  }
}