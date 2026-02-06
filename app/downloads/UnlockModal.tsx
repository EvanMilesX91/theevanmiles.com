'use client';

import { useState, useEffect } from 'react';
import { X, Lock, Mail, Music } from 'lucide-react';
import Image from 'next/image';

interface UnlockModalProps {
  itemType: 'stem' | 'edit';
  itemId: string;
  onClose: () => void;
  onSuccess: (itemId: string) => void;
}

export default function UnlockModal({ itemType, itemId, onClose, onSuccess }: UnlockModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [alreadyUnlocked, setAlreadyUnlocked] = useState(false);

  useEffect(() => {
    checkExistingAccess();
  }, []);

  const checkExistingAccess = async () => {
    try {
      // Check if user has already unlocked via email or Spotify
      const res = await fetch('/api/downloads/check-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId })
      });
      const data = await res.json();
      
      if (data.hasAccess) {
        setAlreadyUnlocked(true);
        // Auto-unlock and close modal
        setTimeout(() => {
          onSuccess(itemId);
        }, 1500);
      }
    } catch (error) {
      console.error('Error checking access:', error);
    } finally {
      setCheckingAccess(false);
    }
  };

  const handleSpotifyUnlock = async () => {
    setLoading(true);
    setError('');
    
    try {
      // Initialize Spotify OAuth flow
      const res = await fetch('/api/downloads/spotify-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, item_type: itemType })
      });
      
      const data = await res.json();
      
      if (data.authUrl) {
        // Store item ID for callback
        localStorage.setItem('unlock_item_id', itemId);
        localStorage.setItem('unlock_item_type', itemType);
        // Redirect to Spotify OAuth
        window.location.href = data.authUrl;
      } else {
        throw new Error('Failed to initiate Spotify authentication');
      }
    } catch (error) {
      console.error('Spotify unlock error:', error);
      setError('Failed to connect to Spotify. Please try email instead.');
      setLoading(false);
    }
  };

  const handleEmailUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/downloads/email-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, item_id: itemId, item_type: itemType })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        onSuccess(itemId);
      } else {
        // Display specific error from API, or custom fallback
        setError(data.error || data.message || "That's not a real email buddy");
      }
    } catch (error) {
      console.error('Email unlock error:', error);
      setError("That's not a real email buddy");
    } finally {
      setLoading(false);
    }
  };

  if (checkingAccess) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="bg-black/90 border-2 border-white rounded-lg p-8 max-w-md w-full mx-4">
          <div className="text-center">
            <div className="animate-spin w-12 h-12 border-4 border-white/30 border-t-white rounded-full mx-auto mb-4"></div>
            <p className="font-mono text-white">Checking access...</p>
          </div>
        </div>
      </div>
    );
  }

  if (alreadyUnlocked) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="bg-black/90 border-2 border-white rounded-lg p-8 max-w-md w-full mx-4">
          <div className="text-center">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-black" />
            </div>
            <h3 className="text-2xl font-bold font-mono mb-2">Already Unlocked!</h3>
            <p className="text-white/70">You already have access to this content.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-black/90 border-2 border-white rounded-lg p-8 max-w-md w-full relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/30">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold font-mono mb-2">UNLOCK DOWNLOAD</h2>
          <p className="text-white/70">Choose one option to unlock this file</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Spotify Option */}
        <div className="mb-6">
          <button
            onClick={handleSpotifyUnlock}
            disabled={loading}
            className="w-full border-2 border-white rounded-lg p-6 bg-white text-black hover:bg-black hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center justify-center gap-3">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              <div className="text-left">
                <div className="font-bold text-lg">Follow on Spotify</div>
                <div className="text-sm opacity-70">Support me on Spotify</div>
              </div>
            </div>
          </button>
        </div>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/30"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="bg-black px-4 text-white/70 font-mono text-sm">OR</span>
          </div>
        </div>

        {/* Email Option */}
        <form onSubmit={handleEmailUnlock}>
          <div className="mb-4">
            <label className="block font-mono text-sm mb-2">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              disabled={loading}
              className="w-full border border-white rounded-lg px-4 py-3 bg-black/60 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full border-2 border-white rounded-lg px-6 py-3 bg-black text-white font-semibold hover:bg-white hover:text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="animate-spin w-5 h-5 border-2 border-white/30 border-t-white rounded-full"></div>
                Unlocking...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Mail className="w-5 h-5" />
                Join Mailing List
              </span>
            )}
          </button>
        </form>

        <p className="text-center text-white/50 text-xs mt-4 font-mono">
          Your data is never shared. Unsubscribe anytime.
        </p>
      </div>
    </div>
  );
}