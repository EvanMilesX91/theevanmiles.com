import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, adminAuthenticated } from '@/lib/admin/auth';
import FplDashboard from './FplDashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'FPL Decision Room | Evan Miles',
  description: 'An automated, explainable Fantasy Premier League decision engine.',
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

export default async function FplHelperPage() {
  const cookieStore = await cookies();
  if (!adminAuthenticated(cookieStore.get(ADMIN_COOKIE)?.value)) {
    redirect('/admin?next=%2Ffpl-helper');
  }

  return <FplDashboard />;
}
