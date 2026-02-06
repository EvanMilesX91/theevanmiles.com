import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { email, source } = await request.json();

    // Validate email
    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }

    // Normalize email (lowercase, trim)
    const normalizedEmail = email.toLowerCase().trim();

    // Get admin client (will throw error if not on server)
    const supabaseAdmin = getSupabaseAdmin();

    // Try to download existing file
    const { data: existingFile, error: downloadError } = await supabaseAdmin.storage
      .from('website-assets')
      .download('mailinglist-signup.txt');

    let existingEmails: string[] = [];

    if (existingFile && !downloadError) {
      // File exists, read its contents
      const text = await existingFile.text();
      existingEmails = text.split('\n').filter(e => e.trim() !== '');
    }

    // Check if email already exists
    if (existingEmails.includes(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Already subscribed' },
        { status: 409 }
      );
    }

    // Add new email to the list
    existingEmails.push(normalizedEmail);

    // Create updated content
    const updatedContent = existingEmails.join('\n') + '\n';

    // Upload updated file back to Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('website-assets')
      .upload('mailinglist-signup.txt', updatedContent, {
        contentType: 'text/plain',
        upsert: true, // This will overwrite the existing file
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to subscribe' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Subscribed successfully',
      email: normalizedEmail,
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}