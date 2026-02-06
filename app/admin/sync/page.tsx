'use client';

import { useState } from 'react';
import { RefreshCw, Database, HardDrive, CheckCircle, AlertCircle } from 'lucide-react';

interface StorageFile {
  name: string;
  size: number;
  path: string;
  type: string;
  bucket: string;
  exists_in_db: boolean;
}

interface SyncPreview {
  stems: {
    tracks: {
      track_name: string;
      track_slug: string;
      files: StorageFile[];
    }[];
  };
  edits: StorageFile[];
  tunes: StorageFile[];
}

export default function AdminSyncPage() {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const scanStorage = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    setPreview(null);

    try {
      const res = await fetch('/api/admin/scan-storage');
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to scan storage');
      }

      setPreview(data);
    } catch (err: any) {
      setError(err.message || 'Failed to scan storage');
    } finally {
      setLoading(false);
    }
  };

  const syncToDatabase = async () => {
    if (!preview) return;

    setSyncing(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/sync-to-database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preview),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to sync');
      }

      setSuccess(
        `Successfully synced! Added ${data.tracks_added} tracks, ${data.stems_added} stems, ${data.edits_added} edits, ${data.tunes_added} tunes.`
      );
      setPreview(null);
    } catch (err: any) {
      setError(err.message || 'Failed to sync to database');
    } finally {
      setSyncing(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const newStemsCount = preview?.stems.tracks.reduce(
    (acc, track) => acc + track.files.filter((f) => !f.exists_in_db).length,
    0
  ) || 0;

  const newEditsCount = preview?.edits.filter((f) => !f.exists_in_db).length || 0;
  const newTunesCount = preview?.tunes.filter((f) => !f.exists_in_db).length || 0;
  const totalNewFiles = newStemsCount + newEditsCount + newTunesCount;

  return (
    <div className="min-h-screen bg-black text-white py-32 px-6">
      <div className="container mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold font-mono mb-4 tracking-wide">SYNC STORAGE</h1>
          <p className="text-white/70">
            Automatically scan your Supabase storage buckets and populate the database
          </p>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
            <div>
              <p className="font-semibold text-red-300">Error</p>
              <p className="text-red-200 text-sm">{error}</p>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-500/20 border border-green-500/50 rounded-lg flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
            <div>
              <p className="font-semibold text-green-300">Success!</p>
              <p className="text-green-200 text-sm">{success}</p>
            </div>
          </div>
        )}

        {/* Scan Button */}
        <div className="mb-8">
          <button
            onClick={scanStorage}
            disabled={loading}
            className="flex items-center gap-3 border-2 border-white rounded-lg px-6 py-3 bg-white text-black font-semibold hover:bg-black hover:text-white transition-colors disabled:opacity-50"
          >
            <HardDrive className="w-5 h-5" />
            {loading ? 'Scanning Storage...' : 'Scan Storage Buckets'}
          </button>
        </div>

        {/* Preview */}
        {preview && (
          <>
            {/* Summary */}
            <div className="mb-8 p-6 border-2 border-white rounded-lg bg-black/60 backdrop-blur-md">
              <h2 className="text-2xl font-bold mb-4 font-mono">SCAN RESULTS</h2>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-white/90">
                    {preview.stems.tracks.length}
                  </div>
                  <div className="text-sm text-white/60">Tracks</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-white/90">{newStemsCount}</div>
                  <div className="text-sm text-white/60">New Stems</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-white/90">{newEditsCount}</div>
                  <div className="text-sm text-white/60">New Edits</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-white/90">{newTunesCount}</div>
                  <div className="text-sm text-white/60">New Tunes</div>
                </div>
              </div>

              {totalNewFiles > 0 && (
                <button
                  onClick={syncToDatabase}
                  disabled={syncing}
                  className="mt-6 w-full flex items-center justify-center gap-3 border-2 border-white rounded-lg px-6 py-3 bg-white text-black font-semibold hover:bg-black hover:text-white transition-colors disabled:opacity-50"
                >
                  <Database className="w-5 h-5" />
                  {syncing ? 'Syncing...' : `Sync ${totalNewFiles} New Files to Database`}
                </button>
              )}

              {totalNewFiles === 0 && (
                <div className="mt-6 text-center text-white/70 font-mono">
                  ✓ Database is up to date!
                </div>
              )}
            </div>

            {/* Stems Preview */}
            {preview.stems.tracks.length > 0 && (
              <div className="mb-8 border-2 border-white rounded-lg p-6 bg-black/60 backdrop-blur-md">
                <h3 className="text-2xl font-bold mb-4 font-mono">STEMS</h3>
                <div className="space-y-4">
                  {preview.stems.tracks.map((track, idx) => {
                    const newFiles = track.files.filter((f) => !f.exists_in_db);
                    return (
                      <div key={idx} className="border border-white/50 rounded-lg p-4 bg-black/40">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h4 className="font-bold font-mono">{track.track_name}</h4>
                            <p className="text-sm text-white/60">
                              {track.files.length} files • {newFiles.length} new
                            </p>
                          </div>
                          {newFiles.length === 0 && (
                            <CheckCircle className="w-5 h-5 text-green-400" />
                          )}
                        </div>
                        <div className="space-y-2">
                          {track.files.map((file, fileIdx) => (
                            <div
                              key={fileIdx}
                              className={`flex items-center justify-between p-2 rounded ${
                                file.exists_in_db
                                  ? 'bg-black/20 text-white/50'
                                  : 'bg-white/10 text-white'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                {file.exists_in_db ? (
                                  <CheckCircle className="w-4 h-4 text-green-400" />
                                ) : (
                                  <RefreshCw className="w-4 h-4 text-yellow-400" />
                                )}
                                <span className="font-mono text-sm">{file.name}</span>
                              </div>
                              <div className="flex items-center gap-4 text-xs">
                                <span className="text-white/60">{formatFileSize(file.size)}</span>
                                <span className="text-white/60 uppercase">{file.type}</span>
                                {file.exists_in_db && (
                                  <span className="text-green-400">In DB</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Edits Preview */}
            {preview.edits.length > 0 && (
              <div className="mb-8 border-2 border-white rounded-lg p-6 bg-black/60 backdrop-blur-md">
                <h3 className="text-2xl font-bold mb-4 font-mono">EDITS</h3>
                <div className="space-y-2">
                  {preview.edits.map((file, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between p-3 rounded ${
                        file.exists_in_db
                          ? 'bg-black/20 text-white/50'
                          : 'bg-white/10 text-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {file.exists_in_db ? (
                          <CheckCircle className="w-4 h-4 text-green-400" />
                        ) : (
                          <RefreshCw className="w-4 h-4 text-yellow-400" />
                        )}
                        <span className="font-mono">{file.name}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-white/60">{formatFileSize(file.size)}</span>
                        <span className="text-white/60 uppercase">{file.type}</span>
                        {file.exists_in_db && (
                          <span className="text-green-400">In DB</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tunes Preview */}
            {preview.tunes.length > 0 && (
              <div className="border-2 border-white rounded-lg p-6 bg-black/60 backdrop-blur-md">
                <h3 className="text-2xl font-bold mb-4 font-mono">TUNES</h3>
                <div className="space-y-2">
                  {preview.tunes.map((file, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between p-3 rounded ${
                        file.exists_in_db
                          ? 'bg-black/20 text-white/50'
                          : 'bg-white/10 text-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {file.exists_in_db ? (
                          <CheckCircle className="w-4 h-4 text-green-400" />
                        ) : (
                          <RefreshCw className="w-4 h-4 text-yellow-400" />
                        )}
                        <span className="font-mono">{file.name}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-white/60">{formatFileSize(file.size)}</span>
                        <span className="text-white/60 uppercase">{file.type}</span>
                        {file.exists_in_db && (
                          <span className="text-green-400">In DB</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Instructions */}
        {!preview && !loading && (
          <div className="border border-white/30 rounded-lg p-6 bg-black/40 backdrop-blur-sm">
            <h3 className="text-xl font-bold mb-3 font-mono">HOW IT WORKS</h3>
            <ol className="space-y-2 text-white/70">
              <li>1. Upload files to Supabase Storage buckets: <code className="text-white">stems</code>, <code className="text-white">edits</code>, or <code className="text-white">tunes</code></li>
              <li>2. Click "Scan Storage Buckets" to detect new files</li>
              <li>3. Review the preview to see what will be added</li>
              <li>4. Click "Sync to Database" to populate the database</li>
              <li>5. Files will appear on the Downloads page automatically</li>
            </ol>
            <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded">
              <p className="text-sm text-yellow-200 mb-2">
                <strong>Bucket Organization:</strong>
              </p>
              <ul className="text-sm text-yellow-200 space-y-1">
                <li>• <strong>stems</strong>: Organize in folders (e.g., <code>stems/hour-glass/drums.wav</code>)</li>
                <li>• <strong>edits</strong>: Remixes and bootlegs</li>
                <li>• <strong>tunes</strong>: Original tracks and unreleased material</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}