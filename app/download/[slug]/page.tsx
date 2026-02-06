'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { CheckCircle, Circle, Music, Mail, Instagram, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Gate } from '@/lib/types';
import Image from 'next/image';
import toast from 'react-hot-toast';

export default function DownloadGatePage() {
  const { slug } = useParams<{ slug: string }>();
  const [gate, setGate] = useState<Gate | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [completedActions, setCompletedActions] = useState({
    spotify_follow: false,
    email: false,
    instagram: false,
  });
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    fetchGate();
  }, [slug]);

  async function fetchGate() {
    const { data, error } = await supabase
      .from('gates')
      .select('*')
      .eq('slug', slug)
      .single();

    if (data) {
      setGate(data);
    } else {
      toast.error('Download gate not found');
    }
    setLoading(false);
  }

  async function handleEmailSubmit() {
    if (!email || !email.includes('@')) {
      toast.error('Please enter a valid email');
      return;
    }

    const response = await fetch('/api/gates/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, gate_id: gate?.id }),
    });

    if (response.ok) {
      setCompletedActions(prev => ({ ...prev, email: true }));
      toast.success('Email verified!');
    }
  }

  async function handleSpotifyFollow() {
    const state = JSON.stringify({
      gate_id: gate?.id,
      email,
      slug,
    });

    const params = new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/api/gates/spotify/callback`,
      state: btoa(state),
      scope: 'user-follow-modify',
    });

    window.location.href = `https://accounts.spotify.com/authorize?${params}`;
  }

  async function handleInstagramFollow() {
    window.open('https://instagram.com/theevanmiles', '_blank');
    
    setTimeout(() => {
      setCompletedActions(prev => ({ ...prev, instagram: true }));
      toast.success('Thanks for following!');
    }, 2000);
  }

  async function handleUnlock() {
    const response = await fetch('/api/gates/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gate_id: gate?.id,
        email,
        completed_actions: completedActions,
      }),
    });

    const data = await response.json();

    if (data.unlocked) {
      setUnlocked(true);
      toast.success('Download unlocked!');
    } else {
      toast.error('Please complete all requirements');
    }
  }

  function checkIfUnlocked() {
    if (!gate) return false;
    
    const required = gate.requirements;
    
    if (required.spotify_follow && !completedActions.spotify_follow) return false;
    if (required.email && !completedActions.email) return false;
    if (required.instagram && !completedActions.instagram) return false;
    
    return true;
  }

  useEffect(() => {
    if (checkIfUnlocked() && !unlocked) {
      handleUnlock();
    }
  }, [completedActions]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-2xl">Loading...</div>
      </div>
    );
  }

  if (!gate) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">Gate Not Found</h1>
          <p className="text-gray-600 dark:text-gray-400">
            This download link doesn't exist or has been removed.
          </p>
        </div>
      </div>
    );
  }

  if (unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-md"
        >
          <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-6" />
          <h1 className="text-4xl font-bold mb-4">Unlocked!</h1>
          <p className="text-xl text-gray-600 dark:text-gray-400 mb-6">
            {gate.success_message}
          </p>
          
          
          <a
            href={gate.file_url}
            download
            className="btn-primary inline-flex items-center gap-2"
          >
            <Download className="w-5 h-5" />
            Download Now
          </a>
          
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-4">
            Check your email at <strong>{email}</strong>
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-20 px-4">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          {/* Cover Art */}
          {gate.cover_url && (
            <div className="w-64 h-64 mx-auto mb-8 rounded-lg overflow-hidden shadow-2xl">
              <Image
                src={gate.cover_url}
                alt={gate.title}
                width={256}
                height={256}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            {gate.title}
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400">
            Complete the steps below to unlock your download
          </p>
        </motion.div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Progress</span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {Object.values(completedActions).filter(Boolean).length} / 
              {Object.values(gate.requirements).filter(Boolean).length} completed
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{
                width: `${(Object.values(completedActions).filter(Boolean).length / 
                          Object.values(gate.requirements).filter(Boolean).length) * 100}%`
              }}
            />
          </div>
        </div>

        {/* Requirements */}
        <div className="space-y-4">
          {/* Email Requirement */}
          {gate.requirements.email && (
            <div className="card">
              <div className="flex items-start gap-4">
                {completedActions.email ? (
                  <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                ) : (
                  <Circle className="w-6 h-6 text-gray-400 flex-shrink-0 mt-1" />
                )}
                
                <div className="flex-1">
                  <h3 className="font-bold mb-2 flex items-center gap-2">
                    <Mail className="w-5 h-5" />
                    Join Email List
                  </h3>
                  
                  {!completedActions.email ? (
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg 
                                 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={handleEmailSubmit}
                        className="btn-primary"
                      >
                        Submit
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-green-600 dark:text-green-400">
                      OK: Email verified for {email}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Spotify Follow Requirement */}
          {gate.requirements.spotify_follow && (
            <div className="card">
              <div className="flex items-start gap-4">
                {completedActions.spotify_follow ? (
                  <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                ) : (
                  <Circle className="w-6 h-6 text-gray-400 flex-shrink-0 mt-1" />
                )}
                
                <div className="flex-1">
                  <h3 className="font-bold mb-2 flex items-center gap-2">
                    <Music className="w-5 h-5" />
                    Follow on Spotify
                  </h3>
                  
                  {!completedActions.spotify_follow ? (
                    <button
                      onClick={handleSpotifyFollow}
                      disabled={gate.requirements.email && !completedActions.email}
                      className="btn-primary disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      Connect Spotify
                    </button>
                  ) : (
                    <p className="text-sm text-green-600 dark:text-green-400">
                      OK: Following on Spotify
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Instagram Follow Requirement */}
          {gate.requirements.instagram && (
            <div className="card">
              <div className="flex items-start gap-4">
                {completedActions.instagram ? (
                  <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                ) : (
                  <Circle className="w-6 h-6 text-gray-400 flex-shrink-0 mt-1" />
                )}
                
                <div className="flex-1">
                  <h3 className="font-bold mb-2 flex items-center gap-2">
                    <Instagram className="w-5 h-5" />
                    Follow on Instagram
                  </h3>
                  
                  {!completedActions.instagram ? (
                    <button
                      onClick={handleInstagramFollow}
                      className="btn-primary"
                    >
                      Follow @theevanmiles
                    </button>
                  ) : (
                    <p className="text-sm text-green-600 dark:text-green-400">
                      OK: Following on Instagram
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Unlock Button */}
        {checkIfUnlocked() && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 text-center"
          >
            <button
              onClick={handleUnlock}
              className="btn-primary px-8 py-4 text-lg"
            >
              <Download className="w-5 h-5 inline mr-2" />
              Unlock Download
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
