import type { Metadata, Viewport } from 'next';
import FplDashboard from './FplDashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'FPL Decision Room',
  description: 'Your Fantasy Premier League team, transfer plan, captain and chip strategy in one place.',
  authors: [],
  creator: 'FPL Decision Room',
  keywords: ['Fantasy Premier League', 'FPL', 'FPL decision tool'],
  openGraph: {
    title: 'FPL Decision Room',
    description: 'Your Fantasy Premier League team, transfer plan, captain and chip strategy in one place.',
    siteName: 'FPL Decision Room',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'FPL Decision Room',
    description: 'Your Fantasy Premier League team, transfer plan, captain and chip strategy in one place.',
  },
  manifest: '/fpl/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/fpl/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/fpl/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/fpl/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'FPL Decision Room',
    statusBarStyle: 'black-translucent',
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#37003c',
};

export default function FplHelperPage() {
  return <FplDashboard />;
}
