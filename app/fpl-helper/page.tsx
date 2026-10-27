import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, adminAuthenticated } from '@/lib/admin/auth';
import FplDashboard from './FplDashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'FPL Decision Room | Evan Miles',
  description: 'An automated, explainable Fantasy Premier League decision engine.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function FplHelperPage() {
  const cookieStore = await cookies();
  if (!adminAuthenticated(cookieStore.get(ADMIN_COOKIE)?.value)) {
    redirect('/admin?next=%2Ffpl-helper');
  }

  return <FplDashboard />;
}
