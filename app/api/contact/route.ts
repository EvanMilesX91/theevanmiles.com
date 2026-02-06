import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    const { name, email, category, message } = await request.json();

    // Determine recipient based on category
    const recipients = {
      booking: 'info@theevanmiles.com',
      press: 'info@theevanmiles.com',
      collaboration: 'evanmilessounds@gmail.com',
      general: 'info@theevanmiles.com',
    };

    const recipientEmail = recipients[category as keyof typeof recipients] || 'info@theevanmiles.com';

    // Send email via Resend
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@theevanmiles.com',
      to: recipientEmail,
      replyTo: email,
      subject: `[${category.toUpperCase()}] New message from ${name}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; border-bottom: 2px solid #6ec8fa; padding-bottom: 10px;">
            New ${category} inquiry
          </h2>
          
          <div style="margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>From:</strong> ${name}</p>
            <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
            <p style="margin: 5px 0;"><strong>Category:</strong> ${category}</p>
          </div>
          
          <div style="background: #f5f5f5; padding: 20px; border-left: 4px solid #6ec8fa; margin: 20px 0;">
            <p style="margin: 0; white-space: pre-wrap;">${message}</p>
          </div>
          
          <p style="color: #666; font-size: 12px; margin-top: 20px;">
            Sent from theevanmiles.com contact form
          </p>
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Contact form error:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}