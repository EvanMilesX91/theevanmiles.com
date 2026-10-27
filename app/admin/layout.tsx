'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock, LogOut, LayoutDashboard, Music, Download, Trophy } from 'lucide-react';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    let active = true;
    localStorage.removeItem('admin_auth');
    fetch('/api/admin/auth', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Could not check your admin session.');
        const session = await response.json();
        if (active) setIsAuthenticated(session.authenticated === true);
      })
      .catch(() => { if (active) setError('Could not check your admin session. Please sign in.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sign-in failed.');
      setPassword('');
      setIsAuthenticated(true);
      const nextPath = new URLSearchParams(window.location.search).get('next');
      if (nextPath?.startsWith('/') && !nextPath.startsWith('//')) {
        window.location.assign(nextPath);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-in failed.');
    } finally { setSubmitting(false); }
  }

  async function handleLogout() {
    try {
      const response = await fetch('/api/admin/auth', { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Sign-out failed. Please try again.');
      setIsAuthenticated(false);
      router.push('/');
    } catch (reason) { alert(reason instanceof Error ? reason.message : 'Sign-out failed. Please try again.'); }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-2xl">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <Lock className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <h1 className="text-3xl font-bold mb-2">Admin Access</h1>
            <p className="text-gray-600 dark:text-gray-400">
              Enter your password to continue
            </p>
          </div>

          <form onSubmit={handleLogin} className="card">
            {error && <p role="alert" className="text-red-600 mb-4">{error}</p>}
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg 
                       bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <button type="submit" disabled={submitting} className="w-full btn-primary">
              {submitting ? 'Signing in…' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Admin Sidebar */}
      <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800">
        <div className="p-6">
          <h2 className="text-2xl font-bold mb-6">Admin Panel</h2>
          
          <nav className="space-y-2">
            <Link
              href="/admin"
              className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <LayoutDashboard className="w-5 h-5" />
              Dashboard
            </Link>
            
            <Link
              href="/admin/presaves/new"
              className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Music className="w-5 h-5" />
              New Presave
            </Link>
            
            <Link
              href="/admin/gates/new"
              className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Download className="w-5 h-5" />
              New Gate
            </Link>

            <Link
              href="/fpl-helper"
              className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Trophy className="w-5 h-5" />
              FPL Decision Room
            </Link>
          </nav>

          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 
                     text-red-600 dark:text-red-400 transition-colors mt-8 w-full"
          >
            <LogOut className="w-5 h-5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 p-8">
        {children}
      </main>
    </div>
  );
}
