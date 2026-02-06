'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

export default function NewGatePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    slug: '',
    title: '',
    file_url: '',
    cover_url: '',
    requirements: {
      email: true,
      spotify_follow: false,
      instagram_follow: false,
    },
    success_message: 'Download unlocked! Check your email for the link.',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Get admin auth from localStorage
      const adminAuth = localStorage.getItem('admin_auth');

      const response = await fetch('/api/admin/create-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth': adminAuth || '',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create gate');
      }

      const { data } = await response.json();
      
      toast.success('Download gate created!');
      router.push(`/download/${data.slug}`);
    } catch (error: any) {
      console.error('Error creating gate:', error);
      toast.error(error.message || 'Failed to create gate');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-heading mb-8">Create Download Gate</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Slug (URL-friendly) *
          </label>
          <input
            type="text"
            required
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            placeholder="exclusive-pack"
            value={formData.slug}
            onChange={(e) =>
              setFormData({ ...formData, slug: e.target.value })
            }
          />
          <p className="text-sm text-gray-500 mt-1">
            Will be used in URL: /download/{formData.slug || 'slug'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Download Title *
          </label>
          <input
            type="text"
            required
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            placeholder="Exclusive Sample Pack"
            value={formData.title}
            onChange={(e) =>
              setFormData({ ...formData, title: e.target.value })
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            File URL (Private) *
          </label>
          <input
            type="url"
            required
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            placeholder="https://..."
            value={formData.file_url}
            onChange={(e) =>
              setFormData({ ...formData, file_url: e.target.value })
            }
          />
          <p className="text-sm text-gray-500 mt-1">
            Upload to Supabase Storage (downloads bucket - PRIVATE) first, then
            paste URL
          </p>
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
          <label className="block text-sm font-medium mb-4">
            Requirements *
          </label>
          <div className="space-y-3">
            <label className="flex items-center">
              <input
                type="checkbox"
                className="w-4 h-4 mr-3"
                checked={formData.requirements.email}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    requirements: {
                      ...formData.requirements,
                      email: e.target.checked,
                    },
                  })
                }
              />
              <span>Join email list</span>
            </label>

            <label className="flex items-center">
              <input
                type="checkbox"
                className="w-4 h-4 mr-3"
                checked={formData.requirements.spotify_follow}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    requirements: {
                      ...formData.requirements,
                      spotify_follow: e.target.checked,
                    },
                  })
                }
              />
              <span>Follow on Spotify</span>
            </label>

            <label className="flex items-center">
              <input
                type="checkbox"
                className="w-4 h-4 mr-3"
                checked={formData.requirements.instagram_follow}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    requirements: {
                      ...formData.requirements,
                      instagram_follow: e.target.checked,
                    },
                  })
                }
              />
              <span>Follow on Instagram (honor system)</span>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Success Message
          </label>
          <textarea
            className="w-full px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-sm"
            rows={3}
            value={formData.success_message}
            onChange={(e) =>
              setFormData({ ...formData, success_message: e.target.value })
            }
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Download Gate'}
        </button>
      </form>
    </div>
  );
}