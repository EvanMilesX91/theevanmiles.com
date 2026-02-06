'use client';
import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'behold-widget': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { 'feed-id': string }, HTMLElement>;
    }
  }
}

export default function HomePage() {
  const [randomNumbers, setRandomNumbers] = useState('000000000');
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [cursorActive, setCursorActive] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
  const [mounted, setMounted] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setMounted(true);
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setRandomNumbers(Math.floor(Math.random() * 1000000000).toString().padStart(9, '0'));
    }, 100);
    return () => clearInterval(interval);
  }, []);

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

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('card-animate');
        });
      },
      { threshold: 0.1, rootMargin: '50px' }
    );
    document.querySelectorAll('.animate-on-scroll').forEach((card) => observerRef.current?.observe(card));
    return () => observerRef.current?.disconnect();
  }, []);

  const ProfileContent = () => (
    <>
      <div className="flex justify-center">
        <div className="relative w-32 h-32 rounded-full overflow-hidden" style={{ border: '2px solid rgba(234, 233, 209, 0.35)' }}>
          <Image
            src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/EM-ProfilePic.jpg"
            alt="Evan Miles"
            fill
            sizes="128px"
            className="object-cover"
            priority
          />
        </div>
      </div>
      <p className="text-sm leading-relaxed text-center lg:text-justify" style={{ color: 'rgba(234, 233, 209, 0.75)', lineHeight: '1.7' }}>
        Evan Miles is an electronic artist and producer from Waterford, Ireland, crafting emotionally driven, dancefloor-focused club music. With over 4 million streams, his work has been supported by Martin Garrix, RÜFÜS DU SOL, Christian Löffler, and Sasha, alongside airplay on BBC Radio 1.
      </p>
      <div className="rounded-lg p-5 space-y-4 glossy-border-gradient">
        <p className="text-sm text-center" style={{ color: 'rgba(234, 233, 209, 0.80)' }}>
          Join The Groupchat for more
        </p>
        {/* WhatsApp - NO JS hover handlers */}
        <a
          href="https://chat.whatsapp.com/Ii2btqwN8oR4uRnnezEJfu"
          target="_blank"
          rel="noopener noreferrer"
          className="whatsapp-btn block w-full rounded-lg px-4 py-2 text-center text-sm font-semibold"
        >
          WhatsApp
        </a>
      </div>
      <div className="flex justify-center">
        <Image
          src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/bone-winky.png"
          alt="Winky"
          width={80}
          height={80}
          className="object-contain"
          style={{ opacity: 0.85 }}
          priority
        />
      </div>
    </>
  );

  return (
    <>
      {/* Video Background */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="fixed inset-0 w-full h-full object-cover"
        style={{ zIndex: 0, opacity: 0.4, pointerEvents: 'none' }}
      >
        <source
          src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/WebsiteBG.mp4"
          type="video/mp4"
        />
      </video>

      {/* Vignette */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at center, transparent 30%, rgba(0,0,0,0.20) 100%)',
          zIndex: 3,
        }}
      />

      {/* Cursor follower - only on desktop */}
      {mounted && !isMobile && (
        <div
          className={`cursor-follower ${cursorActive ? 'active' : ''}`}
          style={{
            left: `${cursorPos.x}px`,
            top: `${cursorPos.y}px`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}

      {/* Main content */}
      <div
        className="relative min-h-screen font-mono"
        style={{ zIndex: 4, color: '#eae9d1' }}
      >
        {/* Random Numbers - Desktop only */}
        {mounted && !isMobile && (
          <div
            className="fixed top-4 right-4 z-30 rounded px-4 py-2"
            style={{
              background: 'rgba(24, 23, 33, 0.65)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(234, 233, 209, 0.30)'
            }}
          >
            <span style={{ color: 'rgba(234, 233, 209, 0.70)' }} className="text-sm tracking-wider">
              {randomNumbers}
            </span>
          </div>
        )}

        {/* DESKTOP ONLY: Fixed Left Sidebar */}
        {mounted && !isMobile && (
          <aside
            className="fixed top-0 left-0 h-screen z-40 overflow-y-auto"
            style={{
              width: '320px',
              borderRight: '1px solid rgba(234, 233, 209, 0.25)',
              background: 'rgba(24, 23, 33, 0.65)',
              backdropFilter: 'blur(12px)'
            }}
          >
            <div className="h-full p-10 flex flex-col gap-10">
              <div className="text-center">
                <h1 className="text-2xl font-bold tracking-widest" style={{ color: 'rgba(234, 233, 209, 0.92)' }}></h1>
              </div>
              <ProfileContent />
              <div className="mt-auto text-center">
                <p className="text-xs tracking-widest" style={{ color: 'rgba(234, 233, 209, 0.60)' }}>EVAN MILES</p>
              </div>
            </div>
          </aside>
        )}

        {/* Main Content Area */}
        <div className={mounted && !isMobile ? 'ml-[320px]' : ''}>
          <div className="container mx-auto px-4 lg:px-6 pt-20 lg:pt-20 pb-8 max-w-6xl">
            <div className="space-y-6 lg:space-y-12">

              {/* MOBILE ONLY: Profile Section */}
              {mounted && isMobile && (
                <section className="glossy-border rounded-2xl p-6 space-y-6">
                  <ProfileContent />
                  <div className="text-center pt-2">
                    <p className="text-xs tracking-widest" style={{ color: 'rgba(234, 233, 209, 0.60)' }}>EVAN MILES</p>
                  </div>
                </section>
              )}

              {/* Evan Miles Live */}
              <section className="glossy-border rounded-2xl p-6 lg:p-10">
                <h2 className="text-xl lg:text-2xl font-bold mb-4 lg:mb-8 tracking-wide" style={{ color: 'rgba(234, 233, 209, 0.92)', letterSpacing: '0.02em' }}>
                  Evan Miles (Live)
                </h2>
                <div className="aspect-video">
                  <video className="w-full h-full rounded-xl" autoPlay muted loop playsInline controls>
                    <source src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/evan-miles-live.mp4" type="video/mp4" />
                  </video>
                </div>
              </section>

              {/* Two Column */}
              <div className="grid lg:grid-cols-2 gap-6 lg:gap-12">
                <section className="animate-on-scroll glossy-border rounded-2xl p-6 lg:p-10">
                  <h2 className="text-xl lg:text-2xl font-bold mb-4 lg:mb-8 tracking-wide" style={{ color: 'rgba(234, 233, 209, 0.92)', letterSpacing: '0.02em' }}>
                    Latest Release
                  </h2>
                  <iframe style={{ borderRadius: '12px' }} src="https://open.spotify.com/embed/artist/13cCyqArWrwa6aq9enBy8l?utm_source=generator" width="100%" height="352" frameBorder="0" allowFullScreen allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>
                </section>
                <section className="animate-on-scroll glossy-border rounded-2xl p-6 lg:p-10">
                  <h2 className="text-xl lg:text-2xl font-bold mb-4 lg:mb-8 tracking-wide" style={{ color: 'rgba(234, 233, 209, 0.92)', letterSpacing: '0.02em' }}>
                    What I&apos;m Feeling Now
                  </h2>
                  <iframe style={{ borderRadius: '12px' }} src="https://open.spotify.com/embed/playlist/1UWb5pz1pakw4UCgmj0AR8?utm_source=generator" width="100%" height="352" frameBorder="0" allowFullScreen allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>
                </section>
              </div>

              {/* Instagram */}
              <section className="animate-on-scroll glossy-border rounded-2xl p-6 lg:p-10">
                <h2 className="text-xl lg:text-2xl font-bold mb-4 lg:mb-8 tracking-wide" style={{ color: 'rgba(234, 233, 209, 0.92)', letterSpacing: '0.02em' }}>
                  Instagram
                </h2>
                <div className="space-y-6">
                  <behold-widget feed-id="2Erb63jEyG1F23oxucNP"></behold-widget>
                  {/* NO JS hover handlers */}
                  <a
                    href="https://www.instagram.com/theevanmiles/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="insta-btn block w-full rounded-lg px-6 py-3 text-center font-semibold"
                  >
                    View on Instagram →
                  </a>
                </div>
              </section>
            </div>
          </div>

          {/* Footer - NO JS hover handlers, using CSS classes */}
          <footer
            className="font-mono"
            style={{
              marginTop: '80px',
              borderTop: '1px solid rgba(234, 233, 209, 0.20)',
              background: 'rgba(24, 23, 33, 0.50)',
              padding: '32px 24px',
            }}
          >
            <div style={{ maxWidth: '72rem', margin: '0 auto', textAlign: 'center' }}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: '24px',
                  marginBottom: '16px',
                }}
              >
                <a href="https://www.instagram.com/theevanmiles/" target="_blank" rel="noopener noreferrer" className="social-link font-mono font-semibold">Instagram</a>
                <a href="https://www.tiktok.com/@yungmiley" target="_blank" rel="noopener noreferrer" className="social-link font-mono font-semibold">TikTok</a>
                <a href="https://soundcloud.com/theevanmiles" target="_blank" rel="noopener noreferrer" className="social-link font-mono font-semibold">SoundCloud</a>
                <a href="https://www.youtube.com/@EvanMiles" target="_blank" rel="noopener noreferrer" className="social-link font-mono font-semibold">YouTube</a>
                <a href="https://open.spotify.com/artist/13cCyqArWrwa6aq9enBy8l" target="_blank" rel="noopener noreferrer" className="social-link font-mono font-semibold">Spotify</a>
              </div>
              <a href="/privacy" className="privacy-link font-mono">Privacy Policy</a>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
