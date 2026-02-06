import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { email, gate_id } = await request.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Invalid email' },
        { status: 400 }
      );
    }

    // Add to email list
    await supabaseAdmin!.from('email_list').insert({
      email,
      source: 'gate',
    });

    // Update or create gate completion record
    const { data: existing } = await supabaseAdmin!
      .from('gate_completions')
      .select('*')
      .eq('gate_id', gate_id)
      .eq('user_email', email)
      .single();

    if (existing) {
      await supabaseAdmin!
        .from('gate_completions')
        .update({
          completed_actions: {
            ...existing.completed_actions,
            email: true,
          },
        })
        .eq('id', existing.id);
    } else {
      await supabaseAdmin!.from('gate_completions').insert({
        gate_id,
        user_email: email,
        completed_actions: { email: true },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Email verification error:', error);
    return NextResponse.json(
      { error: 'Failed to verify email' },
      { status: 500 }
    );
  }
}