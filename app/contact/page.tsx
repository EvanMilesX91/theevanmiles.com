'use client';

import { useState, useEffect } from 'react';
import EmailSignup from '@/components/EmailSignup';

export default function ContactPage() {
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [isCursorActive, setIsCursorActive] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Check if mobile
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);

    // Cursor follower
    const handleMouseMove = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
      setIsCursorActive(true);
    };

    const handleMouseLeave = () => {
      setIsCursorActive(false);
    };

    if (!isMobile) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseleave', handleMouseLeave);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', checkMobile);
    };
  }, [isMobile]);

  return (
    <div className="min-h-screen bg-[#181721] text-[#eae9d1] font-mono relative overflow-hidden">
      {/* Cursor Follower */}
      {!isMobile && (
        <div
          className={`cursor-follower ${isCursorActive ? 'active' : ''}`}
          style={{
            left: cursorPos.x - 20,
            top: cursorPos.y - 20,
          }}
        />
      )}

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
          <source
            src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/WebsiteBG.mp4"
            type="video/mp4"
          />
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

      {/* Main Content */}
      <div className="relative" style={{ zIndex: 10 }}>
        <div className="container mx-auto px-6 py-24 lg:py-32 max-w-3xl">
          
          {/* Page Title */}
          <div className="text-center mb-16">
            <h1 
              className="text-4xl md:text-5xl font-bold tracking-wide mb-4"
              style={{ color: 'rgba(234, 233, 209, 0.92)' }}
            >
              Contact
            </h1>
            <p 
              className="text-sm tracking-wider"
              style={{ color: 'rgba(234, 233, 209, 0.50)' }}
            >
              REACH OUT ANYTIME
            </p>
          </div>

          {/* Main Contact Card */}
          <div 
            className="glossy-border rounded-2xl p-10 mb-12 space-y-10"
          >
            
            {/* Bookings */}
            <div>
              <h2 
                className="text-lg font-semibold mb-3 tracking-wide"
                style={{ color: 'rgba(234, 233, 209, 0.80)' }}
              >
                Bookings / Support
              </h2>
              <a 
                href="mailto:info@theevanmiles.com"
                className="inline-block text-base transition-colors duration-200"
                style={{ color: 'rgba(234, 233, 209, 0.70)' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.95)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.70)'}
              >
                info@theevanmiles.com
              </a>
            </div>

            {/* Divider */}
            <div style={{ height: '1px', background: 'rgba(234, 233, 209, 0.15)' }} />

            {/* Collabs */}
            <div>
              <h2 
                className="text-lg font-semibold mb-3 tracking-wide"
                style={{ color: 'rgba(234, 233, 209, 0.80)' }}
              >
                Music / Collabs
              </h2>
              <a 
                href="mailto:evanmilessounds@gmail.com"
                className="inline-block text-base transition-colors duration-200"
                style={{ color: 'rgba(234, 233, 209, 0.70)' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.95)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.70)'}
              >
                evanmilessounds@gmail.com
              </a>
            </div>

            {/* Divider */}
            <div style={{ height: '1px', background: 'rgba(234, 233, 209, 0.15)' }} />

            {/* Community */}
            <div className="grid md:grid-cols-2 gap-8">
              
              {/* WhatsApp */}
              <div>
                <h3 
                  className="text-base font-semibold mb-3 tracking-wide"
                  style={{ color: 'rgba(234, 233, 209, 0.80)' }}
                >
                  Groupchat
                </h3>
                <p 
                  className="text-xs mb-4 leading-relaxed"
                  style={{ color: 'rgba(234, 233, 209, 0.60)' }}
                >
                  Join the groupchat for more
                </p>
                <a
                  href="https://chat.whatsapp.com/Ii2btqwN8oR4uRnnezEJfu"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center rounded-lg py-3 transition-all duration-200 font-semibold text-sm tracking-wide"
                  style={{
                    background: 'rgba(234, 233, 209, 0.08)',
                    border: '1px solid rgba(234, 233, 209, 0.30)',
                    color: 'rgba(234, 233, 209, 0.92)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(234, 233, 209, 0.15)';
                    e.currentTarget.style.borderColor = 'rgba(234, 233, 209, 0.50)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(234, 233, 209, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(234, 233, 209, 0.30)';
                  }}
                >
                  Join
                </a>
              </div>

              {/* Mailing List */}
              <div>
                <h3 
                  className="text-base font-semibold mb-3 tracking-wide"
                  style={{ color: 'rgba(234, 233, 209, 0.80)' }}
                >
                  Updates
                </h3>
                <p 
                  className="text-xs mb-4 leading-relaxed"
                  style={{ color: 'rgba(234, 233, 209, 0.60)' }}
                >
                  Stay in the loop
                </p>
                <EmailSignup 
                  buttonText="Subscribe"
                />
              </div>

            </div>

          </div>

        </div>

        {/* Footer */}
        <footer 
          className="py-8 mt-20"
          style={{ 
            borderTop: '1px solid rgba(234, 233, 209, 0.20)',
            background: 'rgba(24, 23, 33, 0.50)',
          }}
        >
          <div className="container mx-auto px-6 max-w-6xl">
            <div className="flex flex-wrap justify-center gap-6 mb-4">
              {[
                { name: 'Instagram', url: 'https://www.instagram.com/theevanmiles/' },
                { name: 'TikTok', url: 'https://www.tiktok.com/@yungmiley' },
                { name: 'SoundCloud', url: 'https://soundcloud.com/theevanmiles' },
                { name: 'YouTube', url: 'https://www.youtube.com/@theevanmiles' },
                { name: 'Spotify', url: 'https://open.spotify.com/artist/13cCyqArWrwa6aq9enBy8l' },
              ].map((link) => (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-sm transition-colors duration-200"
                  style={{ color: 'rgba(234, 233, 209, 0.70)' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.95)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.70)'}
                >
                  {link.name}
                </a>
              ))}
            </div>
            <div className="text-center">
              <a 
                href="/privacy-policy" 
                className="text-xs transition-colors duration-200"
                style={{ color: 'rgba(234, 233, 209, 0.50)' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.70)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.50)'}
              >
                Privacy Policy
              </a>
            </div>
          </div>
        </footer>
      </div>

      {/* Keyframe Animations */}
      <style jsx>{`
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

        .glossy-border {
          position: relative;
          background: rgba(24, 23, 33, 0.65);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(234, 233, 209, 0.30);
        }
      `}</style>
    </div>
  );
}