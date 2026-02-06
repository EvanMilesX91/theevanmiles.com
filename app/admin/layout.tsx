'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock, LogOut, LayoutDashboard, Music, Download, Calendar } from 'lucide-react';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const authToken = localStorage.getItem('admin_auth');
    if (authToken === 'authenticated') {
      setIsAuthenticated(true);
    }
    setLoading(false);
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    
    const response = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (response.ok) {
      localStorage.setItem('admin_auth', 'authenticated');
      setIsAuthenticated(true);
    } else {
      alert('Incorrect password');
    }
  }

  function handleLogout() {
    localStorage.removeItem('admin_auth');
    setIsAuthenticated(false);
    router.push('/');
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
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg 
                       bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <button type="submit" className="w-full btn-primary">
              Login
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