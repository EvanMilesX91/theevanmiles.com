import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with service role
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET = 'website-assets';
const FILE_PATH = 'mailinglist-signup.txt';

// Basic email format validation
function isValidEmailFormat(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Verify email using AbstractAPI Email REPUTATION API
async function verifyEmailWithAPI(email: string): Promise<{ valid: boolean; message?: string }> {
  const apiKey = process.env.ABSTRACTAPI_EMAIL_KEY;
  
  console.log('=== EMAIL VERIFICATION DEBUG ===');
  console.log('API Key present:', apiKey ? 'YES' : 'NO');
  console.log('API Key value:', apiKey ? `${apiKey.substring(0, 10)}...` : 'undefined');
  
  if (!apiKey) {
    console.warn('ABSTRACTAPI_EMAIL_KEY not set, skipping advanced verification');
    return { valid: true };
  }

  try {
    // Use Email REPUTATION API endpoint (not validation)
    const url = `https://emailreputation.abstractapi.com/v1/?api_key=${apiKey}&email=${email}`;
    console.log('Calling AbstractAPI Email Reputation for:', email);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error('AbstractAPI returned error status:', response.status);
      const errorText = await response.text();
      console.error('Error response:', errorText);
      return { valid: true }; // Fall back on API error
    }
    
    const data = await response.json();
    
    console.log('Email reputation result:', JSON.stringify(data, null, 2));

    // Check deliverability status
    if (data.email_deliverability?.status === 'undeliverable') {
      const detail = data.email_deliverability.status_detail;
      
      switch (detail) {
        case 'invalid_format':
          return { valid: false, message: 'Invalid email format' };
        case 'invalid_mailbox':
          return { valid: false, message: 'Email address does not exist' };
        case 'full_mailbox':
          return { valid: false, message: 'Email mailbox is full' };
        case 'dns_record_not_found':
          return { valid: false, message: 'Email domain does not exist' };
        case 'unavailable_server':
          return { valid: false, message: 'Email server is unavailable' };
        default:
          return { valid: false, message: 'Email is undeliverable' };
      }
    }

    // Check if format is valid
    if (data.email_deliverability?.is_format_valid === false) {
      return { valid: false, message: 'Invalid email format' };
    }

    // Check if domain has MX records
    if (data.email_deliverability?.is_mx_valid === false) {
      return { valid: false, message: 'Email domain does not exist' };
    }

    // Check if SMTP is valid
    if (data.email_deliverability?.is_smtp_valid === false) {
      return { valid: false, message: 'Email address does not exist' };
    }

    // Check if it's a disposable email
    if (data.email_quality?.is_disposable === true) {
      return { valid: false, message: 'Temporary/disposable emails are not allowed' };
    }

    // Check risk status (optional - you can decide how strict to be)
    if (data.email_risk?.address_risk_status === 'high') {
      return { valid: false, message: 'This email address is flagged as high risk' };
    }

    // All checks passed
    return { valid: true };
  } catch (error) {
    console.error('Email verification API error:', error);
    // If API fails, fall back to basic validation
    return { valid: true };
  }
}

// Read emails from Supabase Storage
async function getEmailsFromStorage(): Promise<string[]> {
  try {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(FILE_PATH);

    if (downloadError) {
      console.log('File does not exist yet, starting fresh');
      return [];
    }

    const content = await fileData.text();
    return content.split('\n').map(e => e.trim().toLowerCase()).filter(e => e !== '');
  } catch (error) {
    console.error('Error reading emails from storage:', error);
    return [];
  }
}

// Add email to Supabase Storage
async function addEmailToStorage(email: string, existingEmails: string[]): Promise<void> {
  try {
    // Add new email to list
    const allEmails = [...existingEmails, email];
    const updatedContent = allEmails.join('\n') + '\n';

    // Upload updated file (upsert = overwrite if exists)
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(FILE_PATH, new Blob([updatedContent], { type: 'text/plain' }), {
        upsert: true,
        contentType: 'text/plain',
      });

    if (uploadError) {
      console.error('Error uploading to storage:', uploadError);
      throw uploadError;
    }

    console.log('Successfully updated mailinglist-signup.txt in Supabase Storage');
  } catch (error) {
    console.error('Error adding email to storage:', error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { email, item_id, item_type } = await request.json();

    if (!email || !item_id || !item_type) {
      return NextResponse.json(
        { error: 'Email, item_id, and item_type are required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Step 1: Basic format validation
    if (!isValidEmailFormat(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Step 2: Check if already subscribed (from Supabase Storage)
    const existingEmails = await getEmailsFromStorage();
    const alreadySubscribed = existingEmails.includes(normalizedEmail);

    if (alreadySubscribed) {
      return NextResponse.json({
        success: true,
        message: 'Already Subscribed!',
        item_id,
        item_type,
        already_subscribed: true,
      });
    }

    // Step 3: Advanced email verification (if API key is set)
    const verificationResult = await verifyEmailWithAPI(normalizedEmail);
    
    if (!verificationResult.valid) {
      return NextResponse.json(
        { error: verificationResult.message || 'Invalid email address' },
        { status: 400 }
      );
    }

    // Step 4: Add to Supabase Storage file
    await addEmailToStorage(normalizedEmail, existingEmails);
    console.log(`New subscriber added to storage: ${normalizedEmail}`);

    // Step 5: Save to database
    try {
      const { error: dbError } = await supabase
        .from('download_unlocks')
        .insert({
          item_type: item_type,
          item_id: item_id,
          unlock_method: 'email',
          user_identifier: normalizedEmail,
        });

      if (dbError) {
        console.error('Database error:', dbError);
        // Don't fail the request if database insert fails - storage write succeeded
      } else {
        console.log(`Unlock saved to database for ${normalizedEmail}`);
      }
    } catch (dbException) {
      console.error('Database exception:', dbException);
      // Continue - storage write succeeded
    }

    return NextResponse.json({
      success: true,
      message: 'Successfully subscribed!',
      item_id,
      item_type,
      already_subscribed: false,
    });
  } catch (error: any) {
    console.error('Error in email unlock:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process email' },
      { status: 500 }
    );
  }
}