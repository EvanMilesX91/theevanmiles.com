import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import Navigation from '@/components/Navigation';
import { Toaster } from 'react-hot-toast';
import Script from 'next/script';

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-ibm-plex-mono',
});

export const metadata: Metadata = {
  title: 'Evan Miles | Electronic Music Producer & DJ',
  description:
    'Official website of Evan Miles - electronic music producer, DJ, and sound designer. Listen to mixes, download exclusive content, and stay updated on new releases.',
  keywords: [
    'Evan Miles',
    'electronic music',
    'DJ',
    'music producer',
    'techno',
    'house',
    'EDM',
  ],
  authors: [{ name: 'Evan Miles' }],
  creator: 'Evan Miles',
  icons: {
    icon: '/icon.png',
    apple: '/icon.png',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://theevanmiles.com',
    title: 'Evan Miles | Electronic Music Producer & DJ',
    description:
      'Website of Evan Miles - electronic music producer and DJ',
    siteName: 'Evan Miles',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Evan Miles | Electronic Music Producer & DJ',
    description:
      'Website of Evan Miles - electronic music producer and DJ',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Behold Instagram Widget Script */}
        <Script
          src="https://w.behold.so/widget.js"
          type="module"
          strategy="lazyOnload"
        />
      </head>
      <body className={`${ibmPlexMono.variable} font-mono antialiased`}>
        <div className="flex flex-col min-h-screen bg-black text-white">
          <Navigation />
          <main className="flex-grow">{children}</main>
        </div>
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#000000',
              color: '#ffffff',
              border: '1px solid #ffffff',
            },
          }}
        />
      </body>
    </html>
  );
}