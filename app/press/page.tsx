'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

export default function PressPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [cursorActive, setCursorActive] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const SUPABASE_URL = 'https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets';

  const bio = `Evan Miles is an electronic artist and producer from Waterford, Ireland, whose music blends emotional depth with modern, dancefloor-ready club energy. Rooted in melodic house and contemporary club rhythms, his sound combines detailed foley percussion, immersive textures, and emotive songwriting, designed to translate both in headphones and in packed rooms.

With over 4 million streams across major digital platforms, Evan has received support from artists including Martin Garrix, RÜFÜS DU SOL, Christian Löffler, and Sasha, alongside airplay on BBC Radio 1, BBC Introducing, and Reprezent Radio.

Recent releases reflect a shift toward a more direct, club-focused sound, drawing influence from artists such as KETTAMA, Fred again.., and X CLUB, while maintaining the emotional weight that has defined his work to date.

Evan has performed across Ireland and the UK, including multiple appearances at Electric Picnic, support slots in London, and shows in Belfast.`;

  // Mount animation
  useEffect(() => {
    setIsMounted(true);
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Cursor follower (matching Mixes page pattern)
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

  // Download individual file
  const downloadFile = async (filename: string) => {
    try {
      const response = await fetch(`${SUPABASE_URL}/${filename}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Error downloading file. Please try again.');
    }
  };

  // Download complete EPK
  const downloadEPK = async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    const files = [
      'evanmiles-presspic1.jpg',
      'evanmiles-logo-black.png',
      'evanmiles-logo-white.png',
    ];

    try {
      const fetchPromises = files.map(async (filename) => {
        const response = await fetch(`${SUPABASE_URL}/${filename}`);
        const blob = await response.blob();
        return { filename, blob };
      });

      const results = await Promise.all(fetchPromises);

      results.forEach(({ filename, blob }) => {
        zip.file(filename, blob);
      });

      zip.file('evanmiles-bio.txt', bio);

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'EvanMiles-PressKit.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error creating press kit:', error);
      alert('Error creating press kit. Please try again.');
    }
  };

  const pressPhotos = [
    { id: 1, filename: 'evanmiles-presspic1.jpg' }
  ];

  const logos = [
    { id: 1, filename: 'evanmiles-logo-white.png', label: 'White Logo' },
    { id: 2, filename: 'evanmiles-logo-black.png', label: 'Black Logo' }
  ];

  return (
    <>
      {/* Orange cursor follower */}
      {!isMobile && (
        <div 
          className={`cursor-follower ${cursorActive ? 'active' : ''}`}
          style={{
            left: `${cursorPos.x}px`,
            top: `${cursorPos.y}px`,
            transform: 'translate(-50%, -50%)'
          }}
        />
      )}

      {/* Base background - Video */}
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden'
      }}>
        <video
          autoPlay
          loop
          muted
          playsInline
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
        >
          <source src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/WebsiteBG.mp4" type="video/mp4" />
        </video>
      </div>

      {/* Subtle violet atmosphere - 10% opacity max */}
      <div className="atmosphere-layer" style={{ opacity: 0.10 }}>
        <div className="atmosphere-gradient-1" style={{
          animation: 'atmosphere-drift 150s ease-in-out infinite'
        }} />
        <div className="atmosphere-gradient-2" style={{
          animation: 'atmosphere-drift 180s ease-in-out infinite reverse',
          animationDelay: '-30s'
        }} />
        <div className="atmosphere-gradient-3" style={{
          animation: 'atmosphere-drift 160s ease-in-out infinite',
          animationDelay: '-60s'
        }} />
      </div>

      {/* Noise layer - very subtle */}
      <div className="noise-layer" style={{ opacity: 0.05 }} />

      {/* Main content */}
      <main className="content-layer min-h-screen">
        <div className="container mx-auto px-6 pb-12 max-w-6xl">
          <div className={`space-y-12 transition-opacity duration-700 ${isMounted ? 'opacity-100' : 'opacity-0'}`}>
            
            {/* Page Title */}
            <div className="text-center" style={{ marginTop: '80px', marginBottom: '56px' }}>
              <h1 
                style={{
                  fontSize: '2.25rem',
                  fontWeight: 700,
                  color: 'rgba(234, 233, 209, 0.92)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                Press
              </h1>
            </div>

            {/* Biography */}
            <section 
              className="glossy-border-wide rounded-2xl p-10"
            >
              <h2 
                className="text-2xl font-bold mb-8 tracking-wide"
                style={{ 
                  color: 'rgba(234, 233, 209, 0.92)',
                  letterSpacing: '0.02em'
                }}
              >
                Biography
              </h2>
              <div 
                className="leading-relaxed whitespace-pre-wrap"
                style={{ 
                  color: 'rgba(234, 233, 209, 0.90)',
                  lineHeight: '1.8'
                }}
              >
                {bio}
              </div>
            </section>

            {/* Press Photos */}
            <section 
              className="glossy-border-wide rounded-2xl p-10"
            >
              <h2 
                className="text-2xl font-bold mb-8 tracking-wide"
                style={{ 
                  color: 'rgba(234, 233, 209, 0.92)',
                  letterSpacing: '0.02em'
                }}
              >
                Press Photos
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {pressPhotos.map((photo) => (
                  <div
                    key={photo.id}
                    className="relative aspect-square rounded-xl overflow-hidden group cursor-pointer"
                    onClick={() => downloadFile(photo.filename)}
                    style={{
                      border: '1px solid rgba(234, 233, 209, 0.30)'
                    }}
                  >
                    <Image
                      src={`${SUPABASE_URL}/${photo.filename}`}
                      alt={`Press Photo ${photo.id}`}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover transition-all duration-300 group-hover:brightness-50"
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="text-center">
                        <div 
                          className="text-sm font-semibold mb-2 tracking-wide"
                          style={{ color: 'rgba(234, 233, 209, 0.92)' }}
                        >
                          {photo.filename}
                        </div>
                        <div 
                          className="text-xl font-bold tracking-wide"
                          style={{ color: 'rgba(234, 233, 209, 0.92)' }}
                        >
                          Download
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Logos */}
            <section 
              className="glossy-border-wide rounded-2xl p-10"
            >
              <h2 
                className="text-2xl font-bold mb-8 tracking-wide"
                style={{ 
                  color: 'rgba(234, 233, 209, 0.92)',
                  letterSpacing: '0.02em'
                }}
              >
                Logos
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {logos.map((logo) => (
                  <div
                    key={logo.id}
                    className="relative aspect-video rounded-xl overflow-hidden group cursor-pointer"
                    onClick={() => downloadFile(logo.filename)}
                    style={{
                      background: logo.label === 'Black Logo' ? 'rgba(234, 233, 209, 0.95)' : 'rgba(24, 23, 33, 0.80)',
                      border: '1px solid rgba(234, 233, 209, 0.30)'
                    }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center p-8">
                      <div className="relative w-full h-full">
                        <Image
                          src={`${SUPABASE_URL}/${logo.filename}`}
                          alt={logo.label}
                          fill
                          sizes="(max-width: 768px) 100vw, 50vw"
                          className="object-contain transition-all duration-300 group-hover:brightness-50"
                        />
                      </div>
                    </div>
                    <div 
                      className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{ background: 'rgba(24, 23, 33, 0.70)' }}
                    >
                      <div className="text-center">
                        <div 
                          className="text-sm font-semibold mb-2 tracking-wide"
                          style={{ color: 'rgba(234, 233, 209, 0.92)' }}
                        >
                          {logo.filename}
                        </div>
                        <div 
                          className="text-xl font-bold tracking-wide"
                          style={{ color: 'rgba(234, 233, 209, 0.92)' }}
                        >
                          Download
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="flex justify-center">
              <button
                onClick={downloadEPK}
                className="rounded-xl px-10 py-4 font-bold text-base tracking-wide transition-all duration-300"
                style={{
                  background: 'rgba(234, 233, 209, 0.08)',
                  border: '1px solid rgba(234, 233, 209, 0.40)',
                  color: 'rgba(234, 233, 209, 0.92)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(234, 233, 209, 0.15)';
                  e.currentTarget.style.borderColor = 'rgba(234, 233, 209, 0.60)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(234, 233, 209, 0.08)';
                  e.currentTarget.style.borderColor = 'rgba(234, 233, 209, 0.40)';
                }}
              >
                Download Complete Press Kit
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer 
          className="mt-12 py-8"
          style={{
            borderTop: '1px solid rgba(234, 233, 209, 0.20)',
            background: 'rgba(24, 23, 33, 0.50)'
          }}
        >
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
                  className="font-semibold transition-all duration-300"
                  style={{ color: 'rgba(234, 233, 209, 0.70)' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.95)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.70)'}
                >
                  {link.name}
                </a>
              ))}
            </div>
            <div className="text-center text-sm">
              <a 
                href="/privacy-policy"
                className="transition-all duration-300"
                style={{ color: 'rgba(234, 233, 209, 0.50)' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.70)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(234, 233, 209, 0.50)'}
              >
                Privacy Policy
              </a>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}