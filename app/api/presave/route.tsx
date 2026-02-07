import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET = 'website-assets';
const FILE_PATH = 'mailinglist-signup.txt';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required.' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address.' },
        { status: 400 }
      );
    }

    const cleanEmail = email.toLowerCase().trim();

    // Download the existing file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(FILE_PATH);

    let existingContent = '';

    if (downloadError) {
      // If file doesn't exist yet, start fresh
      console.warn('Could not download file, starting fresh:', downloadError.message);
    } else {
      existingContent = await fileData.text();
    }

    // Check if email already exists
    const emails = existingContent.split('\n').map((e) => e.trim().toLowerCase());
    if (emails.includes(cleanEmail)) {
      return NextResponse.json({ success: true, message: 'Already subscribed.' });
    }

    // Append the new email
    const updatedContent = existingContent
      ? existingContent.trimEnd() + '\n' + cleanEmail
      : cleanEmail;

    // Re-upload the file (upsert)
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(FILE_PATH, new Blob([updatedContent], { type: 'text/plain' }), {
        upsert: true,
        contentType: 'text/plain',
      });

    if (uploadError) throw uploadError;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Presave API error:', err);
    return NextResponse.json(
      { error: 'Failed to save email.' },
      { status: 500 }
    );
  }
}