// app/presave/[slug]/page.tsx
// Multi-platform presave page with "System Awake" design
// Supports: Spotify (true presave), Deezer (true presave), Apple Music, Amazon, YouTube (smart redirects)

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Platform configurations
const PLATFORMS = {
  spotify: {
    name: 'Spotify',
    color: '#1DB954',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
      </svg>
    ),
    truePresave: true,
  },
  deezer: {
    name: 'Deezer',
    color: '#FEAA2D',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.81 4.16v3.03H24V4.16h-5.19zM6.27 8.38v3.027h5.189V8.38h-5.19zm12.54 0v3.027H24V8.38h-5.19zM6.27 12.59v3.03h5.189v-3.03h-5.19zm6.27 0v3.03h5.19v-3.03h-5.19zm6.27 0v3.03H24v-3.03h-5.19zM0 16.81v3.029h5.19v-3.03H0zm6.27 0v3.029h5.189v-3.03h-5.19zm6.27 0v3.029h5.19v-3.03h-5.19zm6.27 0v3.029H24v-3.03h-5.19z"/>
      </svg>
    ),
    truePresave: true,
  },
  apple: {
    name: 'Apple Music',
    color: '#FA57C1',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 00-1.877-.726 10.496 10.496 0 00-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408-.056.392-.088.785-.1 1.18 0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03a12.5 12.5 0 001.57-.1c.822-.106 1.596-.35 2.295-.81a5.046 5.046 0 001.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.042-1.785-.49-2.07-1.378a1.999 1.999 0 011.93-2.66c.414.012.814.106 1.198.27.083.036.18.048.27.048.12 0 .18-.04.18-.18V8.572c0-.15-.057-.2-.197-.22l-4.588-.793c-.072-.012-.146-.02-.22-.02-.15 0-.18.057-.18.2v6.865c0 .14 0 .28-.01.42-.03.467-.144.91-.477 1.27-.37.404-.848.617-1.394.716-.552.1-1.1.077-1.63-.123-.726-.274-1.17-.78-1.283-1.556-.085-.58.053-1.116.445-1.573.383-.447.89-.688 1.476-.78.375-.057.755-.053 1.127.03.138.03.27.08.404.12.12.037.18.01.18-.12V6.197c0-.15.04-.2.18-.18l6.5 1.12c.16.027.22.08.22.23z"/>
      </svg>
    ),
    truePresave: false,
  },
  amazon: {
    name: 'Amazon Music',
    color: '#00A8E1',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13.958 10.09c0 1.232.029 2.256-.591 3.351-.502.891-1.301 1.438-2.186 1.438-1.214 0-1.922-.924-1.922-2.292 0-2.692 2.415-3.182 4.7-3.182v.685zm3.186 7.705a.659.659 0 01-.75.075c-1.053-.875-1.243-1.281-1.821-2.115-1.742 1.778-2.977 2.31-5.234 2.31-2.67 0-4.752-1.649-4.752-4.948 0-2.576 1.396-4.331 3.383-5.19 1.724-.756 4.134-.891 5.975-1.099v-.41c0-.752.057-1.64-.383-2.291-.385-.579-1.124-.82-1.777-.82-1.21 0-2.286.62-2.55 1.903-.054.285-.261.567-.549.582l-3.061-.333c-.259-.057-.548-.266-.472-.66C6.077 1.556 9.264 0 12.163 0c1.476 0 3.406.392 4.573 1.507 1.476 1.382 1.336 3.228 1.336 5.234v4.742c0 1.425.592 2.05 1.148 2.821.196.276.24.607-.01.81-.624.519-1.732 1.486-2.34 2.028l-.726-.347zm2.47 5.054C17.468 24.012 14.762 24.8 12.385 24.8c-3.327 0-6.323-1.229-8.592-3.276-.178-.16-.019-.378.196-.254 2.444 1.422 5.471 2.28 8.593 2.28 2.108 0 4.426-.437 6.56-1.343.322-.14.593.211.291.442h.001z"/>
      </svg>
    ),
    truePresave: false,
  },
  youtube: {
    name: 'YouTube Music',
    color: '#FF0000',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm5.568 12.672l-7.2 4.32A.792.792 0 019.6 16.32V7.68a.792.792 0 01.768-.672l7.2 4.32a.768.768 0 010 1.344z"/>
      </svg>
    ),
    truePresave: false,
  },
};

type Platform = keyof typeof PLATFORMS;

interface Presave {
  id: string;
  slug: string;
  title: string;
  artist: string;
  release_date: string;
  cover_url?: string;
  headline?: string;
  upc?: string;
  spotify_track_id?: string;
  apple_music_id?: string;
  is_released: boolean;
  success_redirect_url?: string;
}

export default function PresavePage() {
  const { slug } = useParams<{ slug: string }>();
  const [presave, setPresave] = useState<Presave | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  // Cursor follower state
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [cursorActive, setCursorActive] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Fetch presave data
  useEffect(() => {
    async function fetchPresave() {
      const { data, error } = await supabase
        .from('presaves')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single();

      if (data) {
        setPresave(data);
      }
      setLoading(false);
    }

    fetchPresave();
  }, [slug]);

  // Check for mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Cursor tracking
  useEffect(() => {
    if (isMobile) return;

    const handleMouseMove = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseEnter = () => setCursorActive(true);
    const handleMouseLeave = () => setCursorActive(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseenter', handleMouseEnter);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseenter', handleMouseEnter);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isMobile]);

  // Email validation
  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  // Handle presave submission
  const handlePresave = useCallback(async () => {
    if (!email || !isValidEmail(email)) {
      setError('please enter a valid email');
      return;
    }

    if (!selectedPlatform) {
      setError('please select a platform');
      return;
    }

    if (!presave) return;

    setIsSubmitting(true);
    setError('');

    const platformConfig = PLATFORMS[selectedPlatform];

    try {
      // Store email first (for all platforms)
      await supabase.from('email_list').upsert({
        email,
        source: `presave_${slug}`,
      }, {
        onConflict: 'email',
        ignoreDuplicates: true,
      });

      if (platformConfig.truePresave) {
        // OAuth flow for Spotify/Deezer
        const state = btoa(JSON.stringify({
          presave_id: presave.id,
          email,
          slug,
        }));

        if (selectedPlatform === 'spotify') {
          const params = new URLSearchParams({
            client_id: process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!,
            response_type: 'code',
            redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/api/presave/spotify/callback`,
            state,
            scope: 'user-follow-modify user-library-modify',
          });
          window.location.href = `https://accounts.spotify.com/authorize?${params}`;
        } else if (selectedPlatform === 'deezer') {
          const params = new URLSearchParams({
            app_id: process.env.NEXT_PUBLIC_DEEZER_APP_ID!,
            redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/api/presave/deezer/callback`,
            perms: 'basic_access,email,offline_access,manage_library',
            state,
          });
          window.location.href = `https://connect.deezer.com/oauth/auth.php?${params}`;
        }
      } else {
        // Smart redirect for Apple/Amazon/YouTube
        // Store user info, then redirect to platform
        await supabase.from('presave_users').upsert({
          presave_id: presave.id,
          email,
          platform: selectedPlatform,
          followed_artist: false,
          track_saved: false,
        }, {
          onConflict: 'presave_id,email,platform',
          ignoreDuplicates: false,
        });

        // Generate platform-specific URLs
        let redirectUrl = '';
        
        if (selectedPlatform === 'apple') {
          // Apple Music pre-add URL (if track is released and we have ID)
          if (presave.apple_music_id) {
            redirectUrl = `https://music.apple.com/album/${presave.apple_music_id}`;
          } else {
            // Search URL
            redirectUrl = `https://music.apple.com/search?term=${encodeURIComponent(presave.artist + ' ' + presave.title)}`;
          }
        } else if (selectedPlatform === 'amazon') {
          redirectUrl = `https://music.amazon.com/search/${encodeURIComponent(presave.artist + ' ' + presave.title)}`;
        } else if (selectedPlatform === 'youtube') {
          redirectUrl = `https://music.youtube.com/search?q=${encodeURIComponent(presave.artist + ' ' + presave.title)}`;
        }

        // Redirect to success page first
        window.location.href = `/presave/${slug}/success?platform=${selectedPlatform}&redirect=${encodeURIComponent(redirectUrl)}`;
      }
    } catch (err) {
      console.error('Presave error:', err);
      setError('something went wrong · please try again');
      setIsSubmitting(false);
    }
  }, [email, selectedPlatform, presave, slug]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#181721' }}>
        <div className="text-center" style={{ color: 'rgba(234, 233, 209, 0.70)' }}>
          <div className="animate-pulse text-xl font-mono">loading...</div>
        </div>
      </div>
    );
  }

  // Not found state
  if (!presave) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#181721' }}>
        <div className="text-center" style={{ color: 'rgba(234, 233, 209, 0.70)' }}>
          <h1 className="text-2xl font-mono font-bold mb-4" style={{ color: 'rgba(234, 233, 209, 0.92)' }}>
            presave not found
          </h1>
          <p className="font-mono">this link may have expired or been removed</p>
        </div>
      </div>
    );
  }

  const releaseDate = new Date(presave.release_date);
  const formattedDate = releaseDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ backgroundColor: '#181721' }}>
      
      {/* Atmosphere Layer */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 1 }}>
        {/* Gradient 1 */}
        <div
          className="absolute rounded-full"
          style={{
            width: '700px',
            height: '700px',
            top: '10%',
            left: '20%',
            background: 'radial-gradient(circle, rgba(66, 36, 85, 0.18) 0%, transparent 70%)',
            filter: 'blur(70px)',
          }}
        />
        {/* Gradient 2 */}
        <div
          className="absolute rounded-full"
          style={{
            width: '600px',
            height: '600px',
            bottom: '20%',
            right: '15%',
            background: 'radial-gradient(circle, rgba(66, 36, 85, 0.15) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
      </div>

      {/* Noise Layer */}
      <div
        className="fixed pointer-events-none"
        style={{
          inset: '-10%',
          width: '120%',
          height: '120%',
          zIndex: 2,
          opacity: 0.07,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Vignette Layer */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 3,
          background: 'radial-gradient(circle at center, transparent 30%, rgba(0, 0, 0, 0.20) 100%)',
        }}
      />

      {/* Cursor Follower (desktop only) */}
      {!isMobile && (
        <div
          style={{
            position: 'fixed',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: '#cf3a00',
            pointerEvents: 'none',
            zIndex: 9999,
            opacity: cursorActive ? 0.6 : 0,
            transition: 'opacity 0.3s ease',
            mixBlendMode: 'screen',
            filter: 'blur(12px)',
            transform: 'translate(-50%, -50%)',
            left: cursorPos.x,
            top: cursorPos.y,
          }}
        />
      )}

      {/* Content */}
      <div className="relative min-h-screen flex items-center justify-center px-4 py-12" style={{ zIndex: 10 }}>
        <div className="w-full max-w-md">
          
          {/* Card */}
          <div
            className="rounded-2xl p-8 md:p-10"
            style={{
              background: 'rgba(24, 23, 33, 0.65)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(234, 233, 209, 0.30)',
            }}
          >
            {/* Cover Art */}
            {presave.cover_url && (
              <div className="w-48 h-48 mx-auto mb-8 rounded-lg overflow-hidden shadow-2xl">
                <Image
                  src={presave.cover_url}
                  alt={presave.title}
                  width={192}
                  height={192}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Track Info */}
            <div className="text-center mb-8">
              <h1 
                className="text-2xl md:text-3xl font-mono font-bold mb-2"
                style={{ color: 'rgba(234, 233, 209, 0.92)', letterSpacing: '0.02em' }}
              >
                {presave.title}
              </h1>
              <p 
                className="font-mono text-lg mb-3"
                style={{ color: 'rgba(234, 233, 209, 0.70)' }}
              >
                {presave.artist}
              </p>
              <p 
                className="font-mono text-sm"
                style={{ color: 'rgba(234, 233, 209, 0.50)' }}
              >
                {presave.is_released ? 'out now' : `drops ${formattedDate.toLowerCase()}`}
              </p>
            </div>

            {/* Headline */}
            {presave.headline && (
              <p 
                className="text-center font-mono text-sm mb-8"
                style={{ color: 'rgba(234, 233, 209, 0.70)', lineHeight: '1.7' }}
              >
                {presave.headline}
              </p>
            )}

            {/* Email Input */}
            <div className="mb-6">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-4 py-3 rounded-lg font-mono text-sm focus:outline-none transition-all duration-300"
                style={{
                  backgroundColor: 'rgba(24, 23, 33, 0.80)',
                  border: '1px solid rgba(234, 233, 209, 0.25)',
                  color: 'rgba(234, 233, 209, 0.92)',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(234, 233, 209, 0.50)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(234, 233, 209, 0.25)';
                }}
              />
              <p 
                className="font-mono text-xs mt-2"
                style={{ color: 'rgba(234, 233, 209, 0.40)' }}
              >
                we'll remind you on release day · no spam
              </p>
            </div>

            {/* Platform Selection */}
            <div className="mb-6">
              <p 
                className="font-mono text-xs uppercase tracking-widest mb-3"
                style={{ color: 'rgba(234, 233, 209, 0.50)', letterSpacing: '0.08em' }}
              >
                choose your platform
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(PLATFORMS) as [Platform, typeof PLATFORMS[Platform]][]).map(([key, platform]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedPlatform(key)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg font-mono text-sm transition-all duration-300"
                    style={{
                      backgroundColor: selectedPlatform === key 
                        ? platform.color 
                        : 'rgba(24, 23, 33, 0.60)',
                      border: selectedPlatform === key 
                        ? `1px solid ${platform.color}` 
                        : '1px solid rgba(234, 233, 209, 0.20)',
                      color: selectedPlatform === key 
                        ? '#181721' 
                        : 'rgba(234, 233, 209, 0.70)',
                    }}
                  >
                    {platform.icon}
                    <span className="truncate">{platform.name}</span>
                  </button>
                ))}
              </div>
              {selectedPlatform && !PLATFORMS[selectedPlatform].truePresave && (
                <p 
                  className="font-mono text-xs mt-2"
                  style={{ color: 'rgba(234, 233, 209, 0.40)' }}
                >
                  we'll redirect you to {PLATFORMS[selectedPlatform].name} on release
                </p>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <p 
                className="font-mono text-sm text-center mb-4"
                style={{ color: '#cf3a00' }}
              >
                {error}
              </p>
            )}

            {/* Presave Button */}
            <button
              onClick={handlePresave}
              disabled={isSubmitting || !email || !selectedPlatform}
              className="w-full py-4 rounded-lg font-mono font-semibold text-base transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: selectedPlatform ? PLATFORMS[selectedPlatform].color : '#cf3a00',
                color: '#181721',
              }}
            >
              {isSubmitting ? 'connecting...' : presave.is_released ? 'save now' : 'presave'}
            </button>

            {/* Fine Print */}
            <p 
              className="font-mono text-xs text-center mt-6"
              style={{ color: 'rgba(234, 233, 209, 0.40)', lineHeight: '1.6' }}
            >
              {selectedPlatform === 'spotify' && 
                "you'll follow evan miles and the track will be added to your library on release day"
              }
              {selectedPlatform === 'deezer' && 
                "you'll follow evan miles and the track will be added to your library on release day"
              }
              {(selectedPlatform === 'apple' || selectedPlatform === 'amazon' || selectedPlatform === 'youtube') && 
                "we'll email you with a direct link on release day"
              }
              {!selectedPlatform && 
                "select a platform above to presave"
              }
            </p>
          </div>

          {/* Footer Logo */}
          <div className="text-center mt-8">
            <a 
              href="/"
              className="font-mono text-sm font-bold tracking-widest transition-opacity duration-300"
              style={{ color: 'rgba(234, 233, 209, 0.50)' }}
            >
              EVAN MILES
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}