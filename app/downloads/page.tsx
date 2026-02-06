'use client';

import { useState, useEffect } from 'react';
import UnlockModal from './UnlockModal';

interface Track {
  id: string;
  name: string;
  slug: string;
  stems: StemFile[];
}

interface StemFile {
  id: string;
  filename: string;
  file_path: string;
  file_size: number;
  file_type: string;
}

interface EditFile {
  id: string;
  filename: string;
  file_path: string;
  file_size: number;
  file_type: string;
  bucket: string;
}

interface FileRowProps {
  filename: string;
  filesize: string;
  filetype: string;
  isLocked: boolean;
  justUnlocked: boolean;
  onUnlockClick?: () => void;
  onDownloadClick?: () => void;
}

function FileRow({
  filename,
  filesize,
  filetype,
  isLocked,
  justUnlocked,
  onUnlockClick,
  onDownloadClick,
}: FileRowProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="glossy-border-wide group relative"
      style={{ borderRadius: '8px' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="absolute inset-0 rounded-lg transition-all duration-500"
        style={{
          background: justUnlocked
            ? 'rgba(234, 233, 209, 0.08)'
            : 'rgba(24, 23, 33, 0.40)',
          backdropFilter: 'blur(8px)',
          opacity: justUnlocked ? 1 : isHovered ? 0.9 : 0.7,
        }}
      />

      <div className="relative flex items-center justify-between px-6 py-4">
        <div className="flex-1 flex items-center gap-6">
          <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
            {isLocked ? (
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: '#cf3a00',
                  animation: 'pulse-orange-slow 3s ease-in-out infinite',
                }}
              />
            ) : justUnlocked ? (
              <div
                className="font-mono text-xs"
                style={{
                  color: 'rgba(234, 233, 209, 0.50)',
                  animation: 'fade-in 300ms ease-out',
                }}
              >
                ✓
              </div>
            ) : null}
          </div>

          <div
            className="font-mono text-sm tracking-wide flex-1"
            style={{
              color: isLocked
                ? 'rgba(234, 233, 209, 0.50)'
                : 'rgba(234, 233, 209, 0.85)',
            }}
          >
            {filename}
          </div>

          <div className="flex items-center gap-4">
            <span
              className="font-mono text-xs uppercase tracking-widest"
              style={{ color: 'rgba(234, 233, 209, 0.40)' }}
            >
              {filetype}
            </span>
            <span
              className="font-mono text-xs"
              style={{ color: 'rgba(234, 233, 209, 0.40)' }}
            >
              {filesize}
            </span>
          </div>
        </div>

        <div className="flex-shrink-0 ml-8">
          {isLocked ? (
            <button
              onClick={onUnlockClick}
              className="font-mono text-xs uppercase tracking-widest px-4 py-2 rounded transition-all duration-200"
              style={{
                background: isHovered ? '#cf3a00' : 'rgba(207, 58, 0, 0.15)',
                border: isHovered
                  ? '1px solid #cf3a00'
                  : '1px solid rgba(207, 58, 0, 0.30)',
                color: isHovered ? '#eae9d1' : '#cf3a00',
              }}
            >
              unlock
            </button>
          ) : (
            <button
              onClick={onDownloadClick}
              className="font-mono text-xs uppercase tracking-widest px-4 py-2 rounded transition-all duration-200"
              style={{
                background: isHovered
                  ? 'rgba(234, 233, 209, 0.12)'
                  : 'rgba(234, 233, 209, 0.05)',
                border: '1px solid rgba(234, 233, 209, 0.20)',
                color: isHovered
                  ? 'rgba(234, 233, 209, 0.95)'
                  : 'rgba(234, 233, 209, 0.65)',
              }}
            >
              {justUnlocked ? 'access granted' : 'download'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DownloadsPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [edits, setEdits] = useState<EditFile[]>([]);
  const [tunes, setTunes] = useState<EditFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlockedTracks, setUnlockedTracks] = useState<Set<string>>(new Set());
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<{
    type: 'stem' | 'edit';
    id: string;
  } | null>(null);
  const [justUnlocked, setJustUnlocked] = useState<string | null>(null);

  // Cursor follower state
  const [isMobile, setIsMobile] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [cursorActive, setCursorActive] = useState(false);

  // Mobile check
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Cursor follower
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
    fetchDownloads();
    loadUnlockedItems();
  }, []);

  const fetchDownloads = async () => {
    try {
      const [tracksRes, editsRes] = await Promise.all([
        fetch('/api/downloads/stems', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        }),
        fetch('/api/downloads/edits', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        }),
      ]);

      const tracksData = await tracksRes.json();
      const editsData = await editsRes.json();

      setTracks(tracksData || []);

      const editsOnly = editsData.filter((file: EditFile) => file.bucket === 'edits');
      const tunesOnly = editsData.filter((file: EditFile) => file.bucket === 'tunes');

      setEdits(editsOnly || []);
      setTunes(tunesOnly || []);
    } catch (error) {
      console.error('Error fetching downloads:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUnlockedItems = () => {
    const unlocked = localStorage.getItem('unlocked_downloads');
    if (unlocked) {
      setUnlockedTracks(new Set(JSON.parse(unlocked)));
    }
  };

  const handleUnlock = (type: 'stem' | 'edit', id: string) => {
    setSelectedItem({ type, id });
    setShowUnlockModal(true);
  };

  const onUnlockSuccess = (itemId: string) => {
    const newUnlocked = new Set(unlockedTracks);
    newUnlocked.add(itemId);
    setUnlockedTracks(newUnlocked);
    localStorage.setItem('unlocked_downloads', JSON.stringify([...newUnlocked]));
    setShowUnlockModal(false);

    setJustUnlocked(itemId);
    setTimeout(() => {
      setJustUnlocked(null);
    }, 3000);
  };

  const handleDownload = async (
    type: 'stem' | 'edit',
    fileId: string,
    filename: string,
    filePath: string,
    bucket: string
  ) => {
    try {
      // Track the download
      await fetch('/api/downloads/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_type: type, file_id: fileId })
      });

      // Generate download URL
      const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const downloadUrl = `${baseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
      
      // Fetch as blob to force download
      const response = await fetch(downloadUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      
      // Trigger download
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Clean up
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#181721' }}
      >
        <div
          style={{ color: 'rgba(234, 233, 209, 0.50)' }}
          className="font-mono text-sm tracking-wide"
        >
          loading system files...
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Video Background */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="fixed inset-0 w-full h-full object-cover"
        style={{ zIndex: 0, opacity: 0.4 }}
      >
        <source
          src="https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/WebsiteBG.mp4"
          type="video/mp4"
        />
      </video>

      {/* Atmosphere layers */}
      <div
        className="fixed inset-0 overflow-hidden pointer-events-none"
        style={{ zIndex: 1 }}
      >
        <div
          className="absolute rounded-full"
          style={{
            width: '650px',
            height: '650px',
            background:
              'radial-gradient(circle, rgba(66, 36, 85, 0.12) 0%, transparent 70%)',
            filter: 'blur(70px)',
            top: '5%',
            left: '15%',
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: '600px',
            height: '600px',
            background:
              'radial-gradient(circle, rgba(66, 36, 85, 0.10) 0%, transparent 70%)',
            filter: 'blur(65px)',
            top: '60%',
            right: '10%',
          }}
        />
      </div>

      {/* Cursor follower */}
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

      {/* Noise texture */}
      <div
        className="fixed inset-0 pointer-events-none animate-noise-step"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' /%3E%3C/svg%3E")`,
          opacity: 0.07,
          zIndex: 2,
          width: '120%',
          height: '120%',
          left: '-10%',
          top: '-10%',
        }}
      />

      {/* Vignette */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at center, transparent 30%, rgba(0,0,0,0.20) 100%)',
          zIndex: 3,
        }}
      />

      {/* Main content */}
      <div
        className="relative min-h-screen font-mono"
        style={{ zIndex: 4, color: '#eae9d1', fontFamily: "'IBM Plex Mono', monospace" }}
      >
        <div className="max-w-6xl mx-auto px-8 pt-32 pb-24">
          {/* Header */}
          <div className="mb-20">
            <h1
              className="font-bold text-4xl mb-4"
              style={{
                color: 'rgba(234, 233, 209, 0.92)',
                letterSpacing: '0.02em',
              }}
            >
              Free Downloads
            </h1>
            <p
              className="text-sm tracking-wider max-w-2xl"
              style={{
                color: 'rgba(234, 233, 209, 0.50)',
                lineHeight: '1.8',
              }}
            >
              if you want them · use them however you like · nothing required
              (unless locked)
            </p>
          </div>

          {/* Sections */}
          <div className="space-y-20">
            {/* STEMS */}
            {tracks.length > 0 && (
              <section className="space-y-8">
                <h2
                  className="font-mono text-xl uppercase tracking-widest"
                  style={{
                    color: 'rgba(234, 233, 209, 0.70)',
                    letterSpacing: '0.15em',
                  }}
                >
                  stems
                </h2>

                <div className="space-y-10">
                  {tracks.map((track) => {
                    const isUnlocked = unlockedTracks.has(track.id);

                    return (
                      <div key={track.id} className="space-y-4">
                        <div className="flex items-center justify-between pl-10">
                          <div
                            className="font-mono text-xs uppercase tracking-widest"
                            style={{ color: 'rgba(234, 233, 209, 0.50)' }}
                          >
                            {track.name}
                          </div>
                          {!isUnlocked && (
                            <button
                              onClick={() => handleUnlock('stem', track.id)}
                              className="font-mono text-xs uppercase tracking-widest px-4 py-2 rounded transition-all duration-200"
                              style={{
                                background: 'rgba(207, 58, 0, 0.15)',
                                border: '1px solid rgba(207, 58, 0, 0.30)',
                                color: '#cf3a00',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = '#cf3a00';
                                e.currentTarget.style.borderColor = '#cf3a00';
                                e.currentTarget.style.color = '#eae9d1';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background =
                                  'rgba(207, 58, 0, 0.15)';
                                e.currentTarget.style.borderColor =
                                  'rgba(207, 58, 0, 0.30)';
                                e.currentTarget.style.color = '#cf3a00';
                              }}
                            >
                              unlock all stems
                            </button>
                          )}
                        </div>

                        {isUnlocked ? (
                          <div className="space-y-2">
                            {track.stems.map((stem) => (
                              <FileRow
                                key={stem.id}
                                filename={stem.filename}
                                filesize={formatFileSize(stem.file_size)}
                                filetype={stem.file_type.toUpperCase()}
                                isLocked={false}
                                justUnlocked={justUnlocked === track.id}
                                onDownloadClick={() =>
                                  handleDownload(
                                    'stem',
                                    stem.id,
                                    stem.filename,
                                    stem.file_path,
                                    'stems'
                                  )
                                }
                              />
                            ))}
                          </div>
                        ) : (
                          <div
                            className="glossy-border-wide text-center py-12"
                            style={{
                              borderRadius: '8px',
                            }}
                          >
                            <div
                              className="absolute inset-0 rounded-lg"
                              style={{
                                background: 'rgba(24, 23, 33, 0.40)',
                                backdropFilter: 'blur(8px)',
                              }}
                            />
                            <div
                              className="w-3 h-3 rounded-full mx-auto mb-4 relative"
                              style={{
                                background: '#cf3a00',
                                animation: 'pulse-orange-slow 3s ease-in-out infinite',
                              }}
                            />
                            <p
                              className="font-mono text-sm relative"
                              style={{ color: 'rgba(234, 233, 209, 0.50)' }}
                            >
                              {track.stems.length} stems · locked
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* EDITS */}
            {edits.length > 0 && (
              <section className="space-y-8">
                <h2
                  className="font-mono text-xl uppercase tracking-widest"
                  style={{
                    color: 'rgba(234, 233, 209, 0.70)',
                    letterSpacing: '0.15em',
                  }}
                >
                  edits
                </h2>

                <div className="space-y-2">
                  {edits.map((edit) => {
                    const isUnlocked = unlockedTracks.has(edit.id);

                    return (
                      <FileRow
                        key={edit.id}
                        filename={edit.filename}
                        filesize={formatFileSize(edit.file_size)}
                        filetype={edit.file_type.toUpperCase()}
                        isLocked={!isUnlocked}
                        justUnlocked={justUnlocked === edit.id}
                        onUnlockClick={() => handleUnlock('edit', edit.id)}
                        onDownloadClick={() =>
                          handleDownload(
                            'edit',
                            edit.id,
                            edit.filename,
                            edit.file_path,
                            edit.bucket
                          )
                        }
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* TUNES */}
            {tunes.length > 0 && (
              <section className="space-y-8">
                <h2
                  className="font-mono text-xl uppercase tracking-widest"
                  style={{
                    color: 'rgba(234, 233, 209, 0.70)',
                    letterSpacing: '0.15em',
                  }}
                >
                  tunes
                </h2>

                <div className="space-y-2">
                  {tunes.map((tune) => {
                    const isUnlocked = unlockedTracks.has(tune.id);

                    return (
                      <FileRow
                        key={tune.id}
                        filename={tune.filename}
                        filesize={formatFileSize(tune.file_size)}
                        filetype={tune.file_type.toUpperCase()}
                        isLocked={!isUnlocked}
                        justUnlocked={justUnlocked === tune.id}
                        onUnlockClick={() => handleUnlock('edit', tune.id)}
                        onDownloadClick={() =>
                          handleDownload(
                            'edit',
                            tune.id,
                            tune.filename,
                            tune.file_path,
                            tune.bucket
                          )
                        }
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Empty state */}
            {tracks.length === 0 && edits.length === 0 && tunes.length === 0 && (
              <div
                className="text-center py-24 font-mono text-sm"
                style={{ color: 'rgba(234, 233, 209, 0.40)' }}
              >
                no files available yet
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer
          className="font-mono"
          style={{
            marginTop: '80px',
            borderTop: '1px solid rgba(234, 233, 209, 0.20)',
            background: 'rgba(24, 23, 33, 0.50)',
            padding: '32px 24px',
            fontFamily: "'IBM Plex Mono', monospace",
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
              {[
                { label: 'Instagram', href: 'https://www.instagram.com/theevanmiles/' },
                { label: 'TikTok', href: 'https://www.tiktok.com/@yungmiley' },
                { label: 'SoundCloud', href: 'https://soundcloud.com/theevanmiles' },
                { label: 'YouTube', href: 'https://www.youtube.com/@theevanmiles' },
                {
                  label: 'Spotify',
                  href: 'https://open.spotify.com/artist/13cCyqArWrwa6aq9enBy8l',
                },
              ].map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono font-semibold"
                  style={{
                    color: 'rgba(234, 233, 209, 0.70)',
                    textDecoration: 'none',
                    transition: 'color 0.2s',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontWeight: 600,
                  }}
                  onMouseEnter={(e) =>
                    ((e.target as HTMLAnchorElement).style.color =
                      'rgba(234, 233, 209, 0.95)')
                  }
                  onMouseLeave={(e) =>
                    ((e.target as HTMLAnchorElement).style.color =
                      'rgba(234, 233, 209, 0.70)')
                  }
                >
                  {link.label}
                </a>
              ))}
            </div>
            <a
              href="/privacy"
              className="font-mono"
              style={{
                color: 'rgba(234, 233, 209, 0.50)',
                fontSize: '0.75rem',
                textDecoration: 'none',
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              Privacy Policy
            </a>
          </div>
        </footer>
      </div>

      {/* Unlock Modal */}
      {showUnlockModal && selectedItem && (
        <UnlockModal
          itemType={selectedItem.type}
          itemId={selectedItem.id}
          onClose={() => setShowUnlockModal(false)}
          onSuccess={onUnlockSuccess}
        />
      )}
    </>
  );
}