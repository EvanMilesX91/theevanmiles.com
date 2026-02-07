'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';

const RELEASE_DATE = new Date(2026, 1, 27, 0, 0, 0); // Midnight local time, Feb 27 2026
const ARTWORK_URL =
  'https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/Evan%20Miles%20-%20I%20Know%20You%20Hate%20It%20(ART).jpg';
const AUDIO_URL =
  'https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/Evan%20Miles%20-%20I%20Know%20You%20Hate%20It%20(Preview).mp3';
const VIDEO_BG_URL =
  'https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/WebsiteBG.mp4';

const SOCIAL_LINKS = [
  { name: 'Instagram', url: 'https://www.instagram.com/theevanmiles/' },
  { name: 'TikTok', url: 'https://www.tiktok.com/@yungmiley' },
  { name: 'SoundCloud', url: 'https://soundcloud.com/theevanmiles' },
  { name: 'YouTube', url: 'https://www.youtube.com/@EvanMiles' },
  { name: 'Spotify', url: 'https://open.spotify.com/artist/13cCyqArWrwa6aq9enBy8l' },
];

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function getTimeLeft(): TimeLeft | null {
  const now = new Date().getTime();
  const distance = RELEASE_DATE.getTime() - now;
  if (distance <= 0) return null;
  return {
    days: Math.floor(distance / (1000 * 60 * 60 * 24)),
    hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    minutes: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((distance % (1000 * 60)) / 1000),
  };
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function PresaveLatest() {
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(getTimeLeft());
  const [released, setReleased] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Audio player state
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Email form state
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setMounted(true);
    const tl = getTimeLeft();
    if (!tl) {
      setReleased(true);
    }
    const timer = setInterval(() => {
      const tl = getTimeLeft();
      if (!tl) {
        setReleased(true);
        clearInterval(timer);
      }
      setTimeLeft(tl);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Audio player handlers
  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (!isDragging && audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const seekTo = useCallback(
    (clientX: number) => {
      const bar = progressRef.current;
      const audio = audioRef.current;
      if (!bar || !audio || !duration) return;
      const rect = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const pct = x / rect.width;
      const newTime = pct * duration;
      audio.currentTime = newTime;
      setCurrentTime(newTime);
    },
    [duration]
  );

  const handleProgressClick = (e: React.MouseEvent) => {
    seekTo(e.clientX);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    seekTo(e.touches[0].clientX);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      seekTo(e.touches[0].clientX);
    };
    const handleTouchEnd = () => setIsDragging(false);
    const handleMouseMove = (e: MouseEvent) => seekTo(e.clientX);
    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, seekTo]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Email submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || submitting) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/presave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          release: 'I Know You Hate It',
        }),
      });

      if (!res.ok) throw new Error('Failed to save');
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-[#181721] text-[#eae9d1] font-mono relative overflow-hidden">
      {/* Video Background */}
      <div className="fixed inset-0" style={{ zIndex: 0 }}>
        <video
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover"
          style={{ opacity: 0.4 }}
        >
          <source src={VIDEO_BG_URL} type="video/mp4" />
        </video>
      </div>

      {/* Noise Texture */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 2,
          width: '120%',
          height: '120%',
          top: '-10%',
          left: '-10%',
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' /%3E%3C/svg%3E")`,
          opacity: 0.06,
          animation: 'noise-step 10s steps(10) infinite',
        }}
      />

      {/* Vignette */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: 3,
          background: 'radial-gradient(circle at center, transparent 30%, rgba(0,0,0,0.20) 100%)',
        }}
      />

      {/* Content */}
      <div className="relative" style={{ zIndex: 10 }}>
        <div className="min-h-screen flex items-center justify-center px-4 py-20">
          <div className="w-full max-w-md mx-auto text-center">
            {/* Artwork */}
            <div className="relative mx-auto mb-8 w-[280px] h-[280px] sm:w-[340px] sm:h-[340px]">
              <div className="glossy-border-presave rounded-sm overflow-hidden">
                <Image
                  src={ARTWORK_URL}
                  alt="Evan Miles - I Know You Hate It"
                  width={340}
                  height={340}
                  className="w-full h-full object-cover"
                  priority
                />
              </div>
            </div>

            {/* Title */}
            <p
              className="text-xs tracking-[0.3em] uppercase mb-1"
              style={{ color: 'rgba(234, 233, 209, 0.5)' }}
            >
              Evan Miles
            </p>
            <h1
              className="text-2xl sm:text-3xl font-light tracking-widest uppercase mb-1"
              style={{ color: '#eae9d1' }}
            >
              I Know You Hate It
            </h1>
            <p
              className="text-xs tracking-[0.2em] uppercase mb-8"
              style={{ color: 'rgba(234, 233, 209, 0.35)' }}
            >
              {released ? 'Out Now' : 'February 27, 2026'}
            </p>

            {/* Audio Preview Player */}
            <div
              className="mb-10 mx-auto rounded-sm px-4 py-3"
              style={{
                background: 'rgba(234, 233, 209, 0.05)',
                border: '1px solid rgba(234, 233, 209, 0.08)',
              }}
            >
              <audio
                ref={audioRef}
                src={AUDIO_URL}
                preload="metadata"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={handleEnded}
              />

              <div className="flex items-center gap-3">
                {/* Play / Pause */}
                <button
                  onClick={togglePlay}
                  className="presave-play-btn flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                  style={{
                    background: 'rgba(207, 58, 0, 0.9)',
                  }}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="2" y="1" width="3.5" height="12" rx="0.5" fill="#eae9d1" />
                      <rect x="8.5" y="1" width="3.5" height="12" rx="0.5" fill="#eae9d1" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 1.5L12 7L3 12.5V1.5Z" fill="#eae9d1" />
                    </svg>
                  )}
                </button>

                {/* Progress bar + times */}
                <div className="flex-1 min-w-0">
                  <div
                    ref={progressRef}
                    className="relative h-1.5 rounded-full cursor-pointer"
                    style={{ background: 'rgba(234, 233, 209, 0.12)' }}
                    onClick={handleProgressClick}
                    onMouseDown={() => setIsDragging(true)}
                    onTouchStart={handleTouchStart}
                  >
                    <div
                      className="absolute top-0 left-0 h-full rounded-full"
                      style={{
                        width: `${progress}%`,
                        background: '#cf3a00',
                        transition: isDragging ? 'none' : 'width 0.1s linear',
                      }}
                    />
                    {/* Scrubber handle */}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
                      style={{
                        left: `${progress}%`,
                        transform: `translate(-50%, -50%)`,
                        background: '#eae9d1',
                        opacity: isDragging || isPlaying ? 1 : 0,
                        transition: 'opacity 0.2s',
                      }}
                    />
                  </div>
                  <div
                    className="flex justify-between mt-1.5 text-[10px] tracking-wider"
                    style={{ color: 'rgba(234, 233, 209, 0.35)' }}
                  >
                    <span>{formatTime(currentTime)}</span>
                    <span className="uppercase tracking-[0.15em]">Preview</span>
                    <span>{duration > 0 ? formatTime(duration) : '-:--'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Countdown + Presave OR Released State */}
            {released ? (
              <div>
                <p
                  className="text-sm tracking-[0.15em] uppercase mb-6"
                  style={{ color: 'rgba(234, 233, 209, 0.6)' }}
                >
                  Available everywhere now
                </p>
              </div>
            ) : (
              <>
                {/* Countdown */}
                {timeLeft && (
                  <div className="flex justify-center gap-4 sm:gap-6 mb-10">
                    {[
                      { value: timeLeft.days, label: 'Days' },
                      { value: timeLeft.hours, label: 'Hrs' },
                      { value: timeLeft.minutes, label: 'Min' },
                      { value: timeLeft.seconds, label: 'Sec' },
                    ].map((unit) => (
                      <div key={unit.label} className="text-center">
                        <div
                          className="text-3xl sm:text-4xl font-light tracking-wider tabular-nums"
                          style={{ color: '#eae9d1' }}
                        >
                          {unit.value.toString().padStart(2, '0')}
                        </div>
                        <div
                          className="text-[10px] tracking-[0.25em] uppercase mt-1"
                          style={{ color: 'rgba(234, 233, 209, 0.35)' }}
                        >
                          {unit.label}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Email Presave Form */}
                {submitted ? (
                  <div
                    className="py-4 px-5 rounded-sm text-sm tracking-wide"
                    style={{
                      background: 'rgba(207, 58, 0, 0.1)',
                      border: '1px solid rgba(207, 58, 0, 0.25)',
                      color: '#eae9d1',
                    }}
                  >
                    You&apos;re in. We&apos;ll send you a link when it drops.
                  </div>
                ) : (
                  <div>
                    <p
                      className="text-xs tracking-[0.15em] uppercase mb-4"
                      style={{ color: 'rgba(234, 233, 209, 0.5)' }}
                    >
                      Get notified on release day
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setError('');
                        }}
                        placeholder="your@email.com"
                        className="flex-1 min-w-0 px-4 py-3 rounded-sm text-sm tracking-wide outline-none"
                        style={{
                          background: 'rgba(234, 233, 209, 0.06)',
                          border: '1px solid rgba(234, 233, 209, 0.1)',
                          color: '#eae9d1',
                        }}
                      />
                      <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        className="presave-submit-btn px-5 py-3 rounded-sm text-xs tracking-[0.2em] uppercase font-medium flex-shrink-0"
                        style={{
                          background: '#cf3a00',
                          color: '#eae9d1',
                          opacity: submitting ? 0.5 : 1,
                        }}
                      >
                        {submitting ? '...' : 'Notify Me'}
                      </button>
                    </div>
                    {error && (
                      <p
                        className="text-xs mt-2 tracking-wide"
                        style={{ color: '#cf3a00' }}
                      >
                        {error}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer
          className="py-8"
          style={{
            borderTop: '1px solid rgba(234, 233, 209, 0.20)',
            background: 'rgba(24, 23, 33, 0.50)',
          }}
        >
          <div className="container mx-auto px-6 max-w-6xl">
            <div className="flex flex-wrap justify-center gap-6 mb-4">
              {SOCIAL_LINKS.map((link) => (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="presave-social-link font-semibold text-sm"
                >
                  {link.name}
                </a>
              ))}
            </div>
            <div className="text-center">
              <a
                href="/privacy"
                className="presave-privacy-link text-xs"
              >
                Privacy Policy
              </a>
            </div>
          </div>
        </footer>
      </div>

      {/* Styles */}
      <style jsx global>{`
        @keyframes noise-step {
          0%, 100% { transform: translate(0, 0); }
          10% { transform: translate(-5%, -5%); }
          20% { transform: translate(-10%, 5%); }
          30% { transform: translate(5%, -10%); }
          40% { transform: translate(-5%, 10%); }
          50% { transform: translate(10%, -5%); }
          60% { transform: translate(5%, 10%); }
          70% { transform: translate(-10%, -5%); }
          80% { transform: translate(10%, 5%); }
          90% { transform: translate(-5%, -10%); }
        }
        .glossy-border-presave {
          position: relative;
          background: rgba(24, 23, 33, 0.65);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(234, 233, 209, 0.30);
        }
        .presave-play-btn {
          transition: transform 0.15s, opacity 0.15s;
        }
        .presave-play-btn:hover {
          transform: scale(1.08);
        }
        .presave-play-btn:active {
          transform: scale(0.95);
        }
        .presave-submit-btn {
          transition: opacity 0.2s, transform 0.15s;
        }
        .presave-submit-btn:hover {
          opacity: 0.85;
        }
        .presave-submit-btn:active {
          transform: scale(0.97);
        }
        .presave-social-link {
          color: rgba(234, 233, 209, 0.70);
          transition: color 0.2s;
        }
        .presave-social-link:hover {
          color: rgba(234, 233, 209, 0.95);
        }
        .presave-privacy-link {
          color: rgba(234, 233, 209, 0.50);
          transition: color 0.2s;
        }
        .presave-privacy-link:hover {
          color: rgba(234, 233, 209, 0.70);
        }
      `}</style>
    </div>
  );
}