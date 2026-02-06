'use client';

import { useState } from 'react';

interface EmailSignupProps {
  buttonText?: string;
}

export default function EmailSignup({ buttonText = "Subscribe" }: EmailSignupProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/email/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          email,
          source: 'website'
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage('Subscribed');
        setEmail('');
      } else {
        setMessage(data.error || 'Failed');
      }
    } catch (error) {
      setMessage('Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        className="w-full rounded-lg py-3 px-4 mb-3 text-sm font-mono transition-all duration-200"
        style={{
          background: 'rgba(24, 23, 33, 0.65)',
          border: '1px solid rgba(234, 233, 209, 0.30)',
          color: '#eae9d1',
          backdropFilter: 'blur(12px)',
        }}
        onFocus={(e) => {
          e.target.style.borderColor = 'rgba(234, 233, 209, 0.50)';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = 'rgba(234, 233, 209, 0.30)';
        }}
        required
      />
      <button
        type="submit"
        disabled={loading}
        className="w-full text-center rounded-lg py-3 transition-all duration-200 font-semibold text-sm tracking-wide"
        style={{
          background: 'rgba(234, 233, 209, 0.08)',
          border: '1px solid rgba(234, 233, 209, 0.30)',
          color: 'rgba(234, 233, 209, 0.92)',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          if (!loading) {
            e.currentTarget.style.background = 'rgba(234, 233, 209, 0.15)';
            e.currentTarget.style.borderColor = 'rgba(234, 233, 209, 0.50)';
          }
        }}
        onMouseLeave={(e) => {
          if (!loading) {
            e.currentTarget.style.background = 'rgba(234, 233, 209, 0.08)';
            e.currentTarget.style.borderColor = 'rgba(234, 233, 209, 0.30)';
          }
        }}
      >
        {loading ? 'Sending...' : buttonText}
      </button>
      
      {/* Success/Error Messages */}
      {message && (
        <p 
          className="mt-3 text-xs text-center tracking-wide"
          style={{ 
            color: message.includes('Subscribed') 
              ? 'rgba(234, 233, 209, 0.70)' 
              : 'rgba(234, 233, 209, 0.50)' 
          }}
        >
          {message}
        </p>
      )}
    </form>
  );
}