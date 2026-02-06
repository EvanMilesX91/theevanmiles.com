import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendPresaveConfirmation(
  email: string,
  trackTitle: string,
  releaseDate: string
) {
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: email,
      subject: `You've presaved ${trackTitle}!`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="font-size: 32px; font-weight: bold; margin-bottom: 16px;">
            You're Locked In 🎧
          </h1>
          
          <p style="font-size: 18px; color: #666; margin-bottom: 24px;">
            Thanks for presaving <strong>${trackTitle}</strong>!
          </p>
          
          <p style="font-size: 16px; color: #666; margin-bottom: 16px;">
            We'll send you a reminder when it drops on <strong>${releaseDate}</strong>.
          </p>
          
          <p style="font-size: 16px; color: #666;">
            The track will automatically be added to your library and you're now following Evan Miles on Spotify.
          </p>
          
          <div style="margin-top: 32px; padding-top: 32px; border-top: 1px solid #eee;">
            <p style="font-size: 14px; color: #999;">
              — Evan Miles<br />
              <a href="https://theevanmiles.com" style="color: #0066cc;">theevanmiles.com</a>
            </p>
          </div>
        </div>
      `,
    });
  } catch (error) {
    console.error('Failed to send presave confirmation:', error);
  }
}

export async function sendReleaseDayReminder(
  email: string,
  trackTitle: string,
  spotifyUrl: string,
  appleMusicUrl: string
) {
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: email,
      subject: `${trackTitle} is out now!`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="font-size: 32px; font-weight: bold; margin-bottom: 16px;">
            It's Here! 🎉
          </h1>
          
          <p style="font-size: 18px; color: #666; margin-bottom: 24px;">
            <strong>${trackTitle}</strong> is now available everywhere.
          </p>
          
          <div style="margin-bottom: 24px;">
            ${spotifyUrl ? `
              <a href="${spotifyUrl}" style="display: inline-block; background: #1DB954; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-right: 12px; margin-bottom: 12px;">
                Listen on Spotify
              </a>
            ` : ''}
            
            ${appleMusicUrl ? `
              <a href="${appleMusicUrl}" style="display: inline-block; background: linear-gradient(135deg, #FA2D48 0%, #C74B91 100%); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-bottom: 12px;">
                Listen on Apple Music
              </a>
            ` : ''}
          </div>
          
          <p style="font-size: 16px; color: #666;">
            Thanks for the support. Hope you enjoy it.
          </p>
          
          <div style="margin-top: 32px; padding-top: 32px; border-top: 1px solid #eee;">
            <p style="font-size: 14px; color: #999;">
              — Evan Miles<br />
              <a href="https://theevanmiles.com" style="color: #0066cc;">theevanmiles.com</a>
            </p>
          </div>
        </div>
      `,
    });
  } catch (error) {
    console.error('Failed to send release day reminder:', error);
  }
}

export async function sendDownloadUnlocked(
  email: string,
  title: string,
  downloadUrl: string
) {
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: email,
      subject: `Your download is ready: ${title}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="font-size: 32px; font-weight: bold; margin-bottom: 16px;">
            Download Unlocked! 🔓
          </h1>
          
          <p style="font-size: 18px; color: #666; margin-bottom: 24px;">
            Your exclusive content is ready: <strong>${title}</strong>
          </p>
          
          <a href="${downloadUrl}" style="display: inline-block; background: #000; color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-bottom: 24px;">
            Download Now
          </a>
          
          <p style="font-size: 14px; color: #999;">
            This link will expire in 24 hours.
          </p>
          
          <div style="margin-top: 32px; padding-top: 32px; border-top: 1px solid #eee;">
            <p style="font-size: 14px; color: #999;">
              — Evan Miles<br />
              <a href="https://theevanmiles.com" style="color: #0066cc;">theevanmiles.com</a>
            </p>
          </div>
        </div>
      `,
    });
  } catch (error) {
    console.error('Failed to send download unlocked email:', error);
  }
}