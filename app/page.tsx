'use client';

import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';

export default function HomePage() {
  const [randomNumbers, setRandomNumbers] = useState('000000000');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [cursorActive, setCursorActive] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Random numbers animation
  useEffect(() => {
    const interval = setInterval(() => {
      const numbers = Math.floor(Math.random() * 1000000000)
        .toString()
        .padStart(9, '0');
      setRandomNumbers(numbers);
    }, 100);

    return () => clearInterval(interval);
  }, []);

  // Cursor follower
  useEffect(() => {
    if (isMobile) return;

    const handleMouseMove = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
      setCursorActive(true);
    };

    const handleMouseLeave = () => {
      setCursorActive(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.body.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.body.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isMobile]);

  // Intersection Observer for card animations
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('card-animate');
          }
        });
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    const cards = document.querySelectorAll('.animate-on-scroll');
    cards.forEach((card) => observerRef.current?.observe(card));

    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <>
      {/* Video Background */}
      <div className="fixed inset-0 w-full h-full" style={{ zIndex: 0 }}>
        <video
          autoPlay
          muted
          loop
          playsInline
          className="w-full h-full object-cover"
          style={{ position: 'absolute', top: 0, left: 0, opacity: 0.4 }}
        >
          <source 
            src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/WebsiteBG.mp4" 
            type="video/mp4" 
          />
        </video>
      </div>

      {/* Vignette */}
      <div className="vignette-layer" />

      {/* Cursor Follower */}
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

      {/* Content Layer */}
      <div className="content-layer min-h-screen font-mono">
        {/* Random Numbers - Top Right */}
        <div className="fixed top-4 right-4 z-40 rounded px-4 py-2"
          style={{
            background: 'rgba(24, 23, 33, 0.65)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(234, 233, 209, 0.30)'
          }}>
          <span style={{ color: 'rgba(234, 233, 209, 0.70)' }} className="text-sm tracking-wider">
            {randomNumbers}
          </span>
        </div>

        {/* Mobile Sidebar Toggle */}
        {isMobile && (
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="fixed top-4 left-4 z-50 rounded px-4 py-2"
            style={{
              border: '1px solid rgba(234, 233, 209, 0.35)',
              background: 'rgba(24, 23, 33, 0.65)',
              backdropFilter: 'blur(10px)',
              color: 'rgba(234, 233, 209, 0.88)'
            }}
          >
            {sidebarOpen ? '✕' : '☰'}
          </button>
        )}

        {/* Left Sidebar */}
        <aside
          className={`fixed top-0 left-0 h-screen transition-transform duration-300 z-40 overflow-y-auto ${
            isMobile && !sidebarOpen ? '-translate-x-full' : 'translate-x-0'
          }`}
          style={{ 
            width: '320px',
            borderRight: '1px solid rgba(234, 233, 209, 0.25)',
            background: 'rgba(24, 23, 33, 0.65)',
            backdropFilter: 'blur(12px)'
          }}
        >
          <div className="h-full p-10 flex flex-col gap-10">
            {/* Logo */}
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-widest"
                style={{ color: 'rgba(234, 233, 209, 0.92)' }}>
                
              </h1>
            </div>

            {/* Profile Picture */}
            <div className="flex justify-center">
              <div className="relative w-32 h-32 rounded-full overflow-hidden"
                style={{ border: '2px solid rgba(234, 233, 209, 0.35)' }}>
                <Image
                  src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/EM-ProfilePic.jpg"
                  alt="Evan Miles"
                  fill
                  sizes="128px"
                  className="object-cover"
                />
              </div>
            </div>

            {/* Bio */}
            <p className="text-xs leading-relaxed text-justify"
              style={{ 
                color: 'rgba(234, 233, 209, 0.75)',
                lineHeight: '1.7'
              }}>
              Evan Miles is an electronic artist and producer from Waterford, Ireland, crafting emotionally driven, dancefloor-focused club music. With over 4 million streams, his work has been supported by Martin Garrix, RÜFÜS DU SOL, Christian Löffler, and Sasha, alongside airplay on BBC Radio 1.
            </p>

            {/* Groupchat Section */}
            <div className="rounded-lg p-5 space-y-4 glossy-border-gradient">
              <p className="text-sm text-center"
                style={{ color: 'rgba(234, 233, 209, 0.80)' }}>
                Join The Groupchat for more
              </p>
              <a
                href="https://chat.whatsapp.com/Ii2btqwN8oR4uRnnezEJfu"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-lg px-4 py-2 text-center text-sm font-semibold transition-all duration-300 whatsapp-hover"
                style={{
                  border: '1px solid rgba(234, 233, 209, 0.35)',
                  background: 'rgba(234, 233, 209, 0.08)',
                  color: 'rgba(234, 233, 209, 0.92)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#cf3a00';
                  e.currentTarget.style.borderColor = '#cf3a00';
                  e.currentTarget.style.color = '#eae9d1';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(234, 233, 209, 0.08)';
                  e.currentTarget.style.borderColor = 'rgba(234, 233, 209, 0.35)';
                  e.currentTarget.style.color = 'rgba(234, 233, 209, 0.92)';
                }}
              >
                WhatsApp
              </a>
            </div>

            {/* Winky Image */}
            <div className="flex justify-center">
              <Image
                src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/bone-winky.png"
                alt="Winky"
                width={80}
                height={80}
                className="object-contain"
                style={{ opacity: 0.85 }}
              />
            </div>

            {/* Logo Again (Bottom) */}
            <div className="mt-auto text-center">
              <p className="text-xs tracking-widest"
                style={{ color: 'rgba(234, 233, 209, 0.60)' }}>
                EVAN MILES
              </p>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div
          className={`transition-all duration-300 ${
            isMobile && !sidebarOpen ? 'ml-0' : 'ml-[320px]'
          }`}
        >
          <div className="container mx-auto px-6 pt-20 pb-8 max-w-6xl">
            <div className="space-y-12">
              {/* Evan Miles (Live) Section - no animate, already in view on load */}
              <section 
                className="glossy-border rounded-2xl p-10"
              >
                <h2 className="text-2xl font-bold mb-8 tracking-wide"
                  style={{ 
                    color: 'rgba(234, 233, 209, 0.92)',
                    letterSpacing: '0.02em'
                  }}>
                  Evan Miles (Live)
                </h2>
                <div className="aspect-video">
                  <video 
                    className="w-full h-full rounded-xl"
                    autoPlay
                    muted
                    loop
                    playsInline
                    controls
                  >
                    <source 
                      src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/evan-miles-live.mp4" 
                      type="video/mp4" 
                    />
                    Your browser does not support the video tag.
                  </video>
                </div>
              </section>

              {/* Two Column Section */}
              <div className="grid lg:grid-cols-2 gap-12">
                {/* Latest Release */}
                <section 
                  className="animate-on-scroll glossy-border rounded-2xl p-10"
                >
                  <h2 className="text-2xl font-bold mb-8 tracking-wide"
                    style={{ 
                      color: 'rgba(234, 233, 209, 0.92)',
                      letterSpacing: '0.02em'
                    }}>
                    Latest Release
                  </h2>
                  <a
                    href="https://open.spotify.com/artist/13cCyqArWrwa6aq9enBy8l"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block transition-opacity duration-300 hover:opacity-80"
                  >
                    <iframe
                      data-testid="embed-iframe"
                      style={{ borderRadius: '12px' }}
                      src="https://open.spotify.com/embed/artist/13cCyqArWrwa6aq9enBy8l?utm_source=generator"
                      width="100%"
                      height="352"
                      frameBorder="0"
                      allowFullScreen
                      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                      loading="lazy"
                    ></iframe>
                  </a>
                </section>

                {/* What I'm Feeling Now */}
                <section 
                  className="animate-on-scroll glossy-border rounded-2xl p-10"
                >
                  <h2 className="text-2xl font-bold mb-8 tracking-wide"
                    style={{ 
                      color: 'rgba(234, 233, 209, 0.92)',
                      letterSpacing: '0.02em'
                    }}>
                    What I'm Feeling Now
                  </h2>
                  <iframe
                    data-testid="embed-iframe"
                    style={{ borderRadius: '12px' }}
                    src="https://open.spotify.com/embed/playlist/1UWb5pz1pakw4UCgmj0AR8?utm_source=generator"
                    width="100%"
                    height="352"
                    frameBorder="0"
                    allowFullScreen
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="lazy"
                  ></iframe>
                </section>
              </div>

              {/* Instagram Section */}
              <section 
                className="animate-on-scroll glossy-border rounded-2xl p-10"
              >
                <h2 className="text-2xl font-bold mb-8 tracking-wide"
                  style={{ 
                    color: 'rgba(234, 233, 209, 0.92)',
                    letterSpacing: '0.02em'
                  }}>
                  Instagram
                </h2>
                <div className="space-y-6">
                  <behold-widget feed-id="2Erb63jEyG1F23oxucNP"></behold-widget>
                  <a
                    href="https://www.instagram.com/theevanmiles/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full rounded-lg px-6 py-3 text-center font-semibold transition-all duration-300"
                    style={{
                      border: '1px solid rgba(234, 233, 209, 0.35)',
                      background: 'rgba(234, 233, 209, 0.08)',
                      color: 'rgba(234, 233, 209, 0.92)'
                    }}
                  >
                    View on Instagram →
                  </a>
                </div>
              </section>
            </div>
          </div>

          {/* Footer */}
          <footer className="mt-12 py-8"
            style={{
              borderTop: '1px solid rgba(234, 233, 209, 0.20)',
              background: 'rgba(24, 23, 33, 0.50)'
            }}>
            <div className="container mx-auto px-6 max-w-6xl">
              <div className="flex flex-wrap justify-center gap-6 mb-6">
                {[
                  { name: 'Instagram', url: 'https://www.instagram.com/theevanmiles/' },
                  { name: 'TikTok', url: 'https://www.tiktok.com/@yungmiley' },
                  { name: 'SoundCloud', url: 'https://soundcloud.com/theevanmiles' },
                  { name: 'YouTube', url: 'https://www.youtube.com/@theevanmiles' },
                  { name: 'Spotify', url: 'https://open.spotify.com/artist/13cCyqArWrwa6aq9enBy8l' }
                ].map((link) => (
                  <a
                    key={link.name}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold transition-colors duration-300"
                    style={{ color: 'rgba(234, 233, 209, 0.70)' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.95)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.70)'}
                  >
                    {link.name}
                  </a>
                ))}
              </div>
              <div className="text-center">
                <Link
                  href="/privacy"
                  className="text-xs font-semibold transition-colors duration-300"
                  style={{ color: 'rgba(234, 233, 209, 0.50)' }}
                >
                  Privacy Policy
                </Link>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}