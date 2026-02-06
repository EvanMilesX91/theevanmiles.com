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
  const [isCursorActive, setIsCursorActive] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);

    const handleMouseMove = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
      setIsCursorActive(true);
    };
    const handleMouseLeave = () => setIsCursorActive(false);

    if (window.innerWidth >= 1024) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseleave', handleMouseLeave);
    }

    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setRandomNumbers(Math.floor(Math.random() * 1000000000).toString().padStart(9, '0'));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('card-animate');
      }),
      { threshold: 0.1, rootMargin: '50px' }
    );
    document.querySelectorAll('.animate-on-scroll').forEach((card) => observerRef.current?.observe(card));
    return () => observerRef.current?.disconnect();
  }, []);

  const ProfileContent = () => (
    <>
      <div className="flex justify-center">
        <div className="profile-pic relative w-32 h-32 rounded-full overflow-hidden">
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

      <p className="bio-text text-sm leading-relaxed text-center lg:text-justify">
        Evan Miles is an electronic artist and producer from Waterford, Ireland, crafting emotionally driven, dancefloor-focused club music. With over 4 million streams, his work has been supported by Martin Garrix, RÜFÜS DU SOL, Christian Löffler, and Sasha, alongside airplay on BBC Radio 1.
      </p>

      <div className="groupchat-box rounded-lg p-5 space-y-4">
        <p className="groupchat-text text-sm text-center">Join The Groupchat for more</p>
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
    <div className="min-h-screen bg-[#181721] text-[#eae9d1] font-mono relative overflow-hidden">
      {/* Cursor Follower */}
      {!isMobile && (
        <div
          className={`cursor-follower ${isCursorActive ? 'active' : ''}`}
          style={{ left: cursorPos.x - 20, top: cursorPos.y - 20 }}
        />
      )}

      {/* Video Background */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <video autoPlay loop muted playsInline className="w-full h-full object-cover" style={{ opacity: 0.4 }}>
          <source src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/WebsiteBG.mp4" type="video/mp4" />
        </video>
      </div>

      {/* Vignette */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 1, background: 'radial-gradient(circle at center, transparent 30%, rgba(0,0,0,0.20) 100%)' }} />

      {/* Main Content */}
      <div className="relative" style={{ zIndex: 10 }}>
        {/* Random Numbers */}
        <div className="random-numbers fixed top-4 right-4 z-30 rounded px-4 py-2 hidden lg:block pointer-events-none">
          <span className="text-sm tracking-wider">{randomNumbers}</span>
        </div>

        {/* Desktop Sidebar */}
        <aside className="sidebar fixed top-0 left-0 h-screen z-40 overflow-y-auto hidden lg:block">
          <div className="h-full p-10 flex flex-col gap-10">
            <div className="text-center"><h1 className="text-2xl font-bold tracking-widest"></h1></div>
            <ProfileContent />
            <div className="mt-auto text-center">
              <p className="sidebar-footer text-xs tracking-widest">EVAN MILES</p>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="lg:ml-[320px]">
          <div className="container mx-auto px-4 lg:px-6 pt-20 lg:pt-20 pb-8 max-w-6xl">
            <div className="space-y-6 lg:space-y-12">

              {/* Mobile Profile */}
              <section className="glossy-border rounded-2xl p-6 space-y-6 lg:hidden">
                <ProfileContent />
                <div className="text-center pt-2">
                  <p className="sidebar-footer text-xs tracking-widest">EVAN MILES</p>
                </div>
              </section>

              {/* Evan Miles Live */}
              <section className="glossy-border rounded-2xl p-6 lg:p-10">
                <h2 className="section-title text-xl lg:text-2xl font-bold mb-4 lg:mb-8 tracking-wide">Evan Miles (Live)</h2>
                <div className="aspect-video">
                  <video className="w-full h-full rounded-xl" autoPlay muted loop playsInline controls>
                    <source src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/evan-miles-live.mp4" type="video/mp4" />
                  </video>
                </div>
              </section>

              {/* Two Column */}
              <div className="grid lg:grid-cols-2 gap-6 lg:gap-12">
                <section className="animate-on-scroll glossy-border rounded-2xl p-6 lg:p-10">
                  <h2 className="section-title text-xl lg:text-2xl font-bold mb-4 lg:mb-8 tracking-wide">Latest Release</h2>
                  <iframe style={{ borderRadius: '12px' }} src="https://open.spotify.com/embed/artist/13cCyqArWrwa6aq9enBy8l?utm_source=generator" width="100%" height="352" frameBorder="0" allowFullScreen allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>
                </section>
                <section className="animate-on-scroll glossy-border rounded-2xl p-6 lg:p-10">
                  <h2 className="section-title text-xl lg:text-2xl font-bold mb-4 lg:mb-8 tracking-wide">What I&apos;m Feeling Now</h2>
                  <iframe style={{ borderRadius: '12px' }} src="https://open.spotify.com/embed/playlist/1UWb5pz1pakw4UCgmj0AR8?utm_source=generator" width="100%" height="352" frameBorder="0" allowFullScreen allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>
                </section>
              </div>

              {/* Instagram */}
              <section className="animate-on-scroll glossy-border rounded-2xl p-6 lg:p-10">
                <h2 className="section-title text-xl lg:text-2xl font-bold mb-4 lg:mb-8 tracking-wide">Instagram</h2>
                <div className="space-y-6">
                  <behold-widget feed-id="2Erb63jEyG1F23oxucNP"></behold-widget>
                  <a href="https://www.instagram.com/theevanmiles/" target="_blank" rel="noopener noreferrer" className="instagram-btn block w-full rounded-lg px-6 py-3 text-center font-semibold">
                    View on Instagram →
                  </a>
                </div>
              </section>
            </div>
          </div>

          {/* Footer */}
          <footer className="footer py-8 mt-20">
            <div className="container mx-auto px-6 max-w-6xl">
              <div className="flex flex-wrap justify-center gap-6 mb-4">
                <a href="https://www.instagram.com/theevanmiles/" target="_blank" rel="noopener noreferrer" className="social-link font-semibold text-sm">Instagram</a>
                <a href="https://www.tiktok.com/@yungmiley" target="_blank" rel="noopener noreferrer" className="social-link font-semibold text-sm">TikTok</a>
                <a href="https://soundcloud.com/theevanmiles" target="_blank" rel="noopener noreferrer" className="social-link font-semibold text-sm">SoundCloud</a>
                <a href="https://www.youtube.com/@EvanMiles" target="_blank" rel="noopener noreferrer" className="social-link font-semibold text-sm">YouTube</a>
                <a href="https://open.spotify.com/artist/13cCyqArWrwa6aq9enBy8l" target="_blank" rel="noopener noreferrer" className="social-link font-semibold text-sm">Spotify</a>
              </div>
              <div className="text-center">
                <Link href="/privacy" className="privacy-link text-xs">Privacy Policy</Link>
              </div>
            </div>
          </footer>
        </div>
      </div>

      <style jsx>{`
        .profile-pic {
          border: 2px solid rgba(234, 233, 209, 0.35);
        }
        .bio-text {
          color: rgba(234, 233, 209, 0.75);
          line-height: 1.7;
        }
        .groupchat-box {
          background: linear-gradient(135deg, rgba(207, 58, 0, 0.15) 0%, rgba(24, 23, 33, 0.65) 100%);
          border: 1px solid rgba(207, 58, 0, 0.3);
        }
        .groupchat-text {
          color: rgba(234, 233, 209, 0.80);
        }
        .whatsapp-btn {
          border: 1px solid rgba(234, 233, 209, 0.35);
          background: rgba(234, 233, 209, 0.08);
          color: rgba(234, 233, 209, 0.92);
          transition: all 0.3s;
        }
        .whatsapp-btn:hover {
          background: #cf3a00;
          border-color: #cf3a00;
        }
        .random-numbers {
          background: rgba(24, 23, 33, 0.65);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(234, 233, 209, 0.30);
          color: rgba(234, 233, 209, 0.70);
        }
        .sidebar {
          width: 320px;
          border-right: 1px solid rgba(234, 233, 209, 0.25);
          background: rgba(24, 23, 33, 0.65);
          backdrop-filter: blur(12px);
        }
        .sidebar-footer {
          color: rgba(234, 233, 209, 0.60);
        }
        .section-title {
          color: rgba(234, 233, 209, 0.92);
          letter-spacing: 0.02em;
        }
        .instagram-btn {
          border: 1px solid rgba(234, 233, 209, 0.35);
          background: rgba(234, 233, 209, 0.08);
          color: rgba(234, 233, 209, 0.92);
          transition: all 0.3s;
        }
        .instagram-btn:hover {
          background: rgba(234, 233, 209, 0.15);
          border-color: rgba(234, 233, 209, 0.5);
        }
        .footer {
          border-top: 1px solid rgba(234, 233, 209, 0.20);
          background: rgba(24, 23, 33, 0.50);
        }
        .social-link {
          color: rgba(234, 233, 209, 0.70);
          transition: color 0.2s;
        }
        .social-link:hover {
          color: rgba(234, 233, 209, 0.95);
        }
        .privacy-link {
          color: rgba(234, 233, 209, 0.50);
          transition: color 0.2s;
        }
        .privacy-link:hover {
          color: rgba(234, 233, 209, 0.70);
        }
      `}</style>
    </div>
  );
}