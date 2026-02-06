'use client';

import { useEffect, useState } from 'react';

export default function MixesPage() {
  const [isMobile, setIsMobile] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [cursorActive, setCursorActive] = useState(false);

  // ── Mobile check ──
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ── Cursor follower (identical to homepage) ──
  useEffect(() => {
    if (isMobile) return;
    const handleMouseMove = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
      setCursorActive(true);
    };
    const handleMouseLeave = () => setCursorActive(false);

    window.addEventListener('mousemove', handleMouseMove);
    document.body.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.body.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isMobile]);

  // ── Card scroll fade-in ──
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('card-animate');
          }
        });
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    document.querySelectorAll('.animate-on-scroll').forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const mixes = [
    { src: 'https://player-widget.mixcloud.com/widget/iframe/?hide_cover=1&feed=%2Fevanmilesx91%2Fafters-mix-007%2F' },
    { src: 'https://player-widget.mixcloud.com/widget/iframe/?hide_cover=1&feed=%2Fevanmilesx91%2Fafters-mix-006%2F' },
    { src: 'https://player-widget.mixcloud.com/widget/iframe/?hide_cover=1&feed=%2Fevanmilesx91%2Fafters-mix-005%2F' },
  ];

  const socialLinks = [
    { label: 'Instagram', href: 'https://www.instagram.com/theevanmiles/' },
    { label: 'TikTok', href: 'https://www.tiktok.com/@yungmiley' },
    { label: 'SoundCloud', href: 'https://soundcloud.com/theevanmiles' },
    { label: 'YouTube', href: 'https://www.youtube.com/@theevanmiles' },
    { label: 'Spotify', href: 'https://open.spotify.com/artist/13cCyqArWrwa6aq9enBy8l' },
  ];

  return (
    <>
      {/* ── Video Background ── */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, overflow: 'hidden' }}>
        <video
          autoPlay
          loop
          muted
          playsInline
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            position: 'absolute',
            top: 0,
            left: 0,
            opacity: 0.4,
          }}
        >
          <source 
            src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/WebsiteBG.mp4" 
            type="video/mp4" 
          />
        </video>
      </div>

      {/* ── Noise ── */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 2, pointerEvents: 'none',
        opacity: 0.07,
        width: '120%', height: '120%', top: '-10%', left: '-10%',
        animation: 'noise-step 10s steps(10) infinite',
      }}>
        <svg width="100%" height="100%" style={{ display: 'block' }}>
          <filter id="mixes-noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#mixes-noise)" />
        </svg>
      </div>

      {/* ── Vignette ── */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 3, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.20) 100%)',
      }} />

      {/* ── Cursor follower ── */}
      {!isMobile && (
        <div
          className={`cursor-follower ${cursorActive ? 'active' : ''}`}
          style={{
            left: `${cursorPos.x}px`,
            top: `${cursorPos.y}px`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}

      {/* ── Content layer ── */}
      <div className="content-layer min-h-screen font-mono" style={{ color: '#eae9d1', fontFamily: "'IBM Plex Mono', monospace" }}>
        <div style={{ maxWidth: '72rem', margin: '0 auto', padding: '80px 24px 0' }}>

          {/* Title */}
          <div style={{ textAlign: 'center', marginBottom: '56px', marginTop: '32px' }}>
            <h1 style={{
              fontSize: '2.25rem',
              fontWeight: 700,
              color: 'rgba(234, 233, 209, 0.92)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              Mixes
            </h1>
          </div>

          {/* Mixcloud cards — first card visible immediately, rest animate on scroll */}
          {mixes.map((mix, i) => (
            <div
              key={i}
              className={`glossy-border-wide mixcloud-card ${i === 0 ? '' : 'animate-on-scroll'}`}
              style={{
                borderRadius: '16px',
                padding: '40px',
                marginBottom: '40px',
              }}
            >
              <iframe
                width="100%"
                height="120"
                src={mix.src}
                frameBorder="0"
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
                loading="lazy"
                style={{ borderRadius: '8px', position: 'relative', zIndex: 1 }}
              />
            </div>
          ))}

          {/* What I'm Feeling Now */}
          <div
            className="glossy-border-wide animate-on-scroll"
            style={{
              borderRadius: '16px',
              padding: '40px',
              marginBottom: '0',
            }}
          >
            <h2 style={{
              color: 'rgba(234, 233, 209, 0.92)',
              fontSize: '1.25rem',
              fontWeight: 600,
              letterSpacing: '0.02em',
              marginBottom: '24px',
              position: 'relative',
              zIndex: 1,
            }}>
              What I'm Feeling Now
            </h2>
            <iframe
              style={{ borderRadius: '12px', position: 'relative', zIndex: 1 }}
              src="https://open.spotify.com/embed/playlist/1UWb5pz1pakw4UCgmj0AR8?utm_source=generator"
              width="100%"
              height="352"
              frameBorder="0"
              allowFullScreen
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
            />
          </div>
        </div>

        {/* ── Footer ── */}
        <footer style={{
          marginTop: '80px',
          borderTop: '1px solid rgba(234, 233, 209, 0.20)',
          background: 'rgba(24, 23, 33, 0.50)',
          padding: '32px 24px',
        }}>
          <div style={{ maxWidth: '72rem', margin: '0 auto', textAlign: 'center' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '24px', marginBottom: '16px' }}>
              {socialLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'rgba(234, 233, 209, 0.70)',
                    fontWeight: 600,
                    textDecoration: 'none',
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={(e) => (e.target as HTMLAnchorElement).style.color = 'rgba(234, 233, 209, 0.95)'}
                  onMouseLeave={(e) => (e.target as HTMLAnchorElement).style.color = 'rgba(234, 233, 209, 0.70)'}
                >
                  {link.label}
                </a>
              ))}
            </div>
            <a href="/privacy" style={{ color: 'rgba(234, 233, 209, 0.50)', fontSize: '0.75rem', textDecoration: 'none' }}>
              Privacy Policy
            </a>
          </div>
        </footer>
      </div>

      {/* ── Keyframes ── */}
      <style>{`
        /* Animation removed - using video background */
      `}</style>
    </>
  );
}
