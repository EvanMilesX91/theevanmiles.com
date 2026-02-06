'use client';

import { useState } from 'react';
import { Mail, Send, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ContactForm() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    category: 'general',
    message: '',
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const categories = [
    { value: 'booking', label: 'Booking Inquiry', email: 'info@theevanmiles.com' },
    { value: 'press', label: 'Press Inquiry', email: 'info@theevanmiles.com' },
    { value: 'collaboration', label: 'Collaboration Request', email: 'evanmilessounds@gmail.com' },
    { value: 'general', label: 'General Contact', email: 'info@theevanmiles.com' },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.name || !formData.email || !formData.message) {
      toast.error('Please fill in all fields');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setSuccess(true);
        toast.success('Message sent!');
        setFormData({ name: '', email: '', category: 'general', message: '' });
        
        setTimeout(() => setSuccess(false), 3000);
      } else {
        toast.error('Failed to send message');
      }
    } catch (error) {
      console.error('Contact form error:', error);
      toast.error('Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="card text-center py-12">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h3 className="text-2xl font-bold mb-2">Message Sent!</h3>
        <p className="text-gray-600 dark:text-gray-400">
          I'll get back to you soon.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-6">
      {/* Name */}
      <div>
        <label className="block font-medium mb-2">Name *</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Your name"
          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg 
                   bg-white dark:bg-gray-900 focus:ring-2 focus:ring-neuropunk-blue focus:border-transparent"
        />
      </div>

      {/* Email */}
      <div>
        <label className="block font-medium mb-2">Email *</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          placeholder="your@email.com"
          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg 
                   bg-white dark:bg-gray-900 focus:ring-2 focus:ring-neuropunk-blue focus:border-transparent"
        />
      </div>

      {/* Category */}
      <div>
        <label className="block font-medium mb-2">What's this about? *</label>
        <select
          value={formData.category}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg 
                   bg-white dark:bg-gray-900 focus:ring-2 focus:ring-neuropunk-blue focus:border-transparent"
        >
          {categories.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
          Goes to: {categories.find(c => c.value === formData.category)?.email}
        </p>
      </div>

      {/* Message */}
      <div>
        <label className="block font-medium mb-2">Message *</label>
        <textarea
          value={formData.message}
          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
          placeholder="Tell me what's up..."
          rows={6}
          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg 
                   bg-white dark:bg-gray-900 focus:ring-2 focus:ring-neuropunk-blue focus:border-transparent resize-none"
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full btn-primary py-4 text-lg disabled:bg-gray-400 disabled:cursor-not-allowed
                 flex items-center justify-center gap-2"
      >
        {loading ? (
          'Sending...'
        ) : (
          <>
            <Send className="w-5 h-5" />
            Send Message
          </>
        )}
      </button>
    </form>
  );
}