import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { email, release } = await req.json();

    if (!email || !release) {
      return NextResponse.json(
        { error: 'Email and release are required.' },
        { status: 400 }
      );
    }

    const { error } = await supabase.from('presaves').upsert(
      {
        email: email.toLowerCase().trim(),
        release,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'email,release' }
    );

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Failed to save presave.' },
      { status: 500 }
    );
  }
}