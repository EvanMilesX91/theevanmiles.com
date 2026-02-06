'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

export default function NewPresavePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    slug: '',
    upc: '',
    spotify_id: '',
    apple_music_id: '',
    title: '',
    artist: 'Evan Miles',
    release_date: '',
    cover_url: '',
    headline: '',
    email_template: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Get admin auth from localStorage
      const adminAuth = localStorage.getItem('admin_auth');

      const response = await fetch('/api/admin/create-presave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth': adminAuth || '',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create presave');
      }

      const { data } = await response.json();
      
      toast.success('Presave campaign created!');
      router.push(`/presave/${data.slug}`);
    } catch (error: any) {
      console.error('Error creating presave:', error);
      toast.error(error.message || 'Failed to create presave');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-heading mb-8">Create Presave Campaign</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Slug (URL-friendly) *
          </label>
          <input
            type="text"
            required
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            placeholder="my-new-track"
            value={formData.slug}
            onChange={(e) =>
              setFormData({ ...formData, slug: e.target.value })
            }
          />
          <p className="text-sm text-gray-500 mt-1">
            Will be used in URL: /presave/{formData.slug || 'slug'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Track Title *
          </label>
          <input
            type="text"
            required
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            placeholder="My New Track"
            value={formData.title}
            onChange={(e) =>
              setFormData({ ...formData, title: e.target.value })
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Artist *</label>
          <input
            type="text"
            required
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            value={formData.artist}
            onChange={(e) =>
              setFormData({ ...formData, artist: e.target.value })
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Release Date *
          </label>
          <input
            type="date"
            required
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            value={formData.release_date}
            onChange={(e) =>
              setFormData({ ...formData, release_date: e.target.value })
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Cover Image URL *
          </label>
          <input
            type="url"
            required
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            placeholder="https://..."
            value={formData.cover_url}
            onChange={(e) =>
              setFormData({ ...formData, cover_url: e.target.value })
            }
          />
          <p className="text-sm text-gray-500 mt-1">
            Upload to Supabase Storage (covers bucket) first, then paste URL
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Spotify Track ID
          </label>
          <input
            type="text"
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            placeholder="7qiZfU4dY1lWllzX7mPBI3"
            value={formData.spotify_id}
            onChange={(e) =>
              setFormData({ ...formData, spotify_id: e.target.value })
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">UPC</label>
          <input
            type="text"
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            placeholder="123456789012"
            value={formData.upc}
            onChange={(e) =>
              setFormData({ ...formData, upc: e.target.value })
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Apple Music ID
          </label>
          <input
            type="text"
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            placeholder="1234567890"
            value={formData.apple_music_id}
            onChange={(e) =>
              setFormData({ ...formData, apple_music_id: e.target.value })
            }
          />
          <p className="text-sm text-gray-500 mt-1">
            Coming soon - Apple Music integration not yet implemented
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Headline/Description
          </label>
          <textarea
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            rows={3}
            placeholder="Pre-save my new track dropping soon!"
            value={formData.headline}
            onChange={(e) =>
              setFormData({ ...formData, headline: e.target.value })
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Email Template
          </label>
          <textarea
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            rows={4}
            placeholder="Thanks for pre-saving! You'll be notified when it drops."
            value={formData.email_template}
            onChange={(e) =>
              setFormData({ ...formData, email_template: e.target.value })
            }
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Presave Campaign'}
        </button>
      </form>
    </div>
  );
}