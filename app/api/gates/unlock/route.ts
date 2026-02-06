import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { gate_id, email, completed_actions } = await request.json();

    // Get gate requirements
    const { data: gate } = await supabaseAdmin
      .from('gates')
      .select('*')
      .eq('id', gate_id)
      .single();

    if (!gate) {
      return NextResponse.json(
        { error: 'Gate not found' },
        { status: 404 }
      );
    }

    // Check if all requirements are met
    const requirements = gate.requirements;
    let allComplete = true;

    if (requirements.spotify_follow && !completed_actions.spotify_follow) {
      allComplete = false;
    }
    if (requirements.email && !completed_actions.email) {
      allComplete = false;
    }
    if (requirements.instagram && !completed_actions.instagram) {
      allComplete = false;
    }

    if (!allComplete) {
      return NextResponse.json(
        { unlocked: false, message: 'Not all requirements completed' },
        { status: 400 }
      );
    }

    // Mark as unlocked
    const { data: existing } = await supabaseAdmin
      .from('gate_completions')
      .select('*')
      .eq('gate_id', gate_id)
      .eq('user_email', email)
      .single();

    if (existing) {
      await supabaseAdmin
        .from('gate_completions')
        .update({
          unlocked: true,
          completed_actions,
        })
        .eq('id', existing.id);
    } else {
      await supabaseAdmin.from('gate_completions').insert({
        gate_id,
        user_email: email,
        completed_actions,
        unlocked: true,
      });
    }

    // Generate signed URL for file download (if using private storage)
    const { data: signedUrl } = await supabaseAdmin.storage
      .from('downloads')
      .createSignedUrl(gate.file_url, 3600); // 1 hour expiry

    return NextResponse.json({
      unlocked: true,
      download_url: signedUrl?.signedUrl || gate.file_url,
    });
  } catch (error) {
    console.error('Gate unlock error:', error);
    return NextResponse.json(
      { error: 'Failed to unlock gate' },
      { status: 500 }
    );
  }
}