'use client';

import Link from 'next/link';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#181721] text-[#eae9d1] px-6 py-24 md:px-16 lg:px-32">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-block mb-8 text-sm tracking-widest uppercase opacity-50 hover:opacity-90 transition-opacity"
        >
          ← Back
        </Link>

        <h1
          className="text-3xl md:text-4xl font-light tracking-widest uppercase mb-2"
          style={{ color: '#eae9d1' }}
        >
          Privacy Policy
        </h1>
        <p className="text-sm tracking-wide opacity-40 mb-16">
          Last updated: February 2025
        </p>

        <div className="space-y-12 text-sm leading-relaxed tracking-wide opacity-80">
          <section>
            <h2 className="text-base uppercase tracking-widest mb-4 opacity-100" style={{ color: '#cf3a00' }}>
              Overview
            </h2>
            <p>
              This privacy policy explains how theevanmiles.com (&quot;the Site&quot;), operated by Evan Miles,
              collects, uses, and protects your personal information. By using this Site, you agree to the
              practices described below.
            </p>
          </section>

          <section>
            <h2 className="text-base uppercase tracking-widest mb-4 opacity-100" style={{ color: '#cf3a00' }}>
              Information We Collect
            </h2>
            <p className="mb-3">
              We may collect the following information when you interact with the Site:
            </p>
            <p className="mb-2">
              <span className="opacity-100">Email address</span> — provided when you sign up for updates, access
              download gates, or use presave features.
            </p>
            <p className="mb-2">
              <span className="opacity-100">Name</span> — if optionally provided through contact forms.
            </p>
            <p className="mb-2">
              <span className="opacity-100">Spotify account data</span> — if you choose to authenticate via
              Spotify OAuth, we may access your Spotify user ID and display name. We do not access your
              listening history or playlists.
            </p>
            <p>
              <span className="opacity-100">Usage data</span> — basic analytics data such as page views and
              referral sources may be collected through privacy-respecting analytics tools.
            </p>
          </section>

          <section>
            <h2 className="text-base uppercase tracking-widest mb-4 opacity-100" style={{ color: '#cf3a00' }}>
              How We Use Your Information
            </h2>
            <p>
              Your information is used to deliver content you&apos;ve requested (such as music downloads or
              presave confirmations), to send occasional updates about new releases, shows, and projects, and
              to improve the Site experience. We will never sell your personal data to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-base uppercase tracking-widest mb-4 opacity-100" style={{ color: '#cf3a00' }}>
              Data Storage
            </h2>
            <p>
              Personal information is stored securely using Supabase, a hosted database platform with
              row-level security and encryption. Data is stored on servers within the EU/EEA where possible.
              We retain your data only for as long as necessary to provide the services described above.
            </p>
          </section>

          <section>
            <h2 className="text-base uppercase tracking-widest mb-4 opacity-100" style={{ color: '#cf3a00' }}>
              Third-Party Services
            </h2>
            <p className="mb-3">
              The Site integrates with the following third-party services, each with their own privacy policies:
            </p>
            <p className="mb-2">
              <span className="opacity-100">Spotify</span> — for OAuth authentication and embedded players.{' '}
              <a href="https://www.spotify.com/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:opacity-100 transition-opacity" style={{ color: '#cf3a00' }}>
                Spotify Privacy Policy
              </a>
            </p>
            <p className="mb-2">
              <span className="opacity-100">SoundCloud / Mixcloud</span> — for embedded mix players.
            </p>
            <p className="mb-2">
              <span className="opacity-100">Instagram (Behold widget)</span> — for displaying recent posts.
            </p>
            <p>
              <span className="opacity-100">Supabase</span> — for data storage and authentication.{' '}
              <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:opacity-100 transition-opacity" style={{ color: '#cf3a00' }}>
                Supabase Privacy Policy
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-base uppercase tracking-widest mb-4 opacity-100" style={{ color: '#cf3a00' }}>
              Cookies
            </h2>
            <p>
              The Site may use essential cookies required for functionality such as authentication sessions.
              We do not use tracking cookies or serve advertising. Third-party embeds (Spotify, SoundCloud,
              Instagram) may set their own cookies according to their respective policies.
            </p>
          </section>

          <section>
            <h2 className="text-base uppercase tracking-widest mb-4 opacity-100" style={{ color: '#cf3a00' }}>
              Your Rights
            </h2>
            <p>
              Under GDPR and applicable data protection laws, you have the right to access, correct, or
              delete your personal data at any time. You may also withdraw consent for email communications
              by using the unsubscribe link in any email or by contacting us directly. To exercise any of
              these rights, please reach out using the contact details below.
            </p>
          </section>

          <section>
            <h2 className="text-base uppercase tracking-widest mb-4 opacity-100" style={{ color: '#cf3a00' }}>
              Contact
            </h2>
            <p>
              If you have any questions about this privacy policy or your data, you can reach out via the{' '}
              <Link href="/contact" className="underline underline-offset-4 hover:opacity-100 transition-opacity" style={{ color: '#cf3a00' }}>
                contact page
              </Link>{' '}
              or email directly at{' '}
              <a href="mailto:hello@theevanmiles.com" className="underline underline-offset-4 hover:opacity-100 transition-opacity" style={{ color: '#cf3a00' }}>
                hello@theevanmiles.com
              </a>.
            </p>
          </section>
        </div>

        <div className="mt-20 pt-8 border-t border-[#eae9d1]/10 text-xs tracking-wide opacity-30">
          © {new Date().getFullYear()} Evan Miles. All rights reserved.
        </div>
      </div>
    </div>
  );
}