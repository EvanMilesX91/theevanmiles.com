'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Download, Music, Mail, LogOut, RefreshCw } from 'lucide-react';
import Link from 'next/link';

interface Stats {
  totalPresaves: number;
  totalGates: number;
  emailSubscribers: number;
  totalDownloads: number;
  totalTracks: number;
  totalEdits: number;
  totalTunes: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({
    totalPresaves: 0,
    totalGates: 0,
    emailSubscribers: 0,
    totalDownloads: 0,
    totalTracks: 0,
    totalEdits: 0,
    totalTunes: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/stats', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      const data = await res.json();
      console.log('Fetched stats:', data);
      setStats(data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_authenticated');
    router.push('/admin');
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-white/30 bg-black/70 backdrop-blur-md mt-20">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold font-mono tracking-wide mb-2">ADMIN DASHBOARD</h1>
              <p className="text-white/70">Manage your content and view analytics</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchStats}
                disabled={refreshing}
                className="flex items-center gap-2 border border-white/50 rounded-lg px-4 py-2 hover:bg-white/10 transition-colors text-white/70 hover:text-white disabled:opacity-50"
                title="Refresh stats"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 border border-white/50 rounded-lg px-4 py-2 hover:bg-white/10 transition-colors text-white/70 hover:text-white"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 pt-12 pb-16 max-w-7xl">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <div className="border-2 border-white rounded-lg p-6 bg-black/60 backdrop-blur-md">
            <div className="flex items-center gap-3 mb-2">
              <Music className="w-5 h-5 text-white/70" />
              <p className="text-white/70 text-sm font-semibold">Total Stem Folders</p>
            </div>
            <p className="text-4xl font-bold font-mono">{stats.totalTracks}</p>
          </div>

          <div className="border-2 border-white rounded-lg p-6 bg-black/60 backdrop-blur-md">
            <div className="flex items-center gap-3 mb-2">
              <Download className="w-5 h-5 text-white/70" />
              <p className="text-white/70 text-sm font-semibold">Total Edits</p>
            </div>
            <p className="text-4xl font-bold font-mono">{stats.totalEdits}</p>
          </div>

          <div className="border-2 border-white rounded-lg p-6 bg-black/60 backdrop-blur-md">
            <div className="flex items-center gap-3 mb-2">
              <Music className="w-5 h-5 text-white/70" />
              <p className="text-white/70 text-sm font-semibold">Total Tunes</p>
            </div>
            <p className="text-4xl font-bold font-mono">{stats.totalTunes}</p>
          </div>

          <div className="border-2 border-white rounded-lg p-6 bg-black/60 backdrop-blur-md">
            <div className="flex items-center gap-3 mb-2">
              <Mail className="w-5 h-5 text-white/70" />
              <p className="text-white/70 text-sm font-semibold">Email Subscribers</p>
            </div>
            <p className="text-4xl font-bold font-mono">{stats.emailSubscribers}</p>
          </div>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {/* Sync Storage */}
          <Link
            href="/admin/sync"
            className="border-2 border-white rounded-lg p-8 bg-black/60 backdrop-blur-md hover:bg-white/5 transition-colors group"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full border-2 border-white flex items-center justify-center group-hover:bg-white group-hover:text-black transition-colors">
                <RefreshCw className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-2xl font-bold font-mono">Sync Storage</h3>
                <p className="text-white/70">Sync files from Supabase to database</p>
              </div>
            </div>
            <p className="text-white/60 text-sm">
              Automatically detect new files in stems, edits, and tunes buckets and add them to the database
            </p>
          </Link>

          {/* Create Presave */}
          <Link
            href="/admin/presaves/new"
            className="border-2 border-white rounded-lg p-8 bg-black/60 backdrop-blur-md hover:bg-white/5 transition-colors group"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full border-2 border-white flex items-center justify-center group-hover:bg-white group-hover:text-black transition-colors">
                <Music className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-2xl font-bold font-mono">Create Presave</h3>
                <p className="text-white/70">Set up a new presave campaign</p>
              </div>
            </div>
            <p className="text-white/60 text-sm">
              Create presave campaigns for upcoming releases on Spotify
            </p>
          </Link>

          {/* Create Download Gate */}
          <Link
            href="/admin/gates/new"
            className="border-2 border-white rounded-lg p-8 bg-black/60 backdrop-blur-md hover:bg-white/5 transition-colors group"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full border-2 border-white flex items-center justify-center group-hover:bg-white group-hover:text-black transition-colors">
                <Download className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-2xl font-bold font-mono">Create Download Gate</h3>
                <p className="text-white/70">Gate exclusive content</p>
              </div>
            </div>
            <p className="text-white/60 text-sm">
              Create download gates that require social follows or email signup
            </p>
          </Link>

          {/* View Analytics */}
          <Link
            href="/admin/analytics"
            className="border-2 border-white rounded-lg p-8 bg-black/60 backdrop-blur-md hover:bg-white/5 transition-colors group"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full border-2 border-white flex items-center justify-center group-hover:bg-white group-hover:text-black transition-colors">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-2xl font-bold font-mono">View Analytics</h3>
                <p className="text-white/70">Download stats and insights</p>
              </div>
            </div>
            <p className="text-white/60 text-sm">
              View detailed download statistics and user engagement metrics
            </p>
          </Link>
        </div>

        {/* Quick Stats */}
        <div className="border-2 border-white rounded-lg p-8 bg-black/60 backdrop-blur-md">
          <h2 className="text-2xl font-bold font-mono mb-6">QUICK STATS</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <p className="text-white/70 text-sm mb-2">Presaves Created</p>
              <p className="text-3xl font-bold font-mono">{stats.totalPresaves}</p>
            </div>
            <div>
              <p className="text-white/70 text-sm mb-2">Download Gates Created</p>
              <p className="text-3xl font-bold font-mono">{stats.totalGates}</p>
            </div>
            <div>
              <p className="text-white/70 text-sm mb-2">Total Downloads</p>
              <p className="text-3xl font-bold font-mono">{stats.totalDownloads}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}