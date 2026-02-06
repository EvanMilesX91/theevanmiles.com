'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center max-w-md"
      >
        {/* Glitchy 404 */}
        <div className="mb-8">
          <h1 className="text-9xl font-bold mb-4 glitch-text" data-text="404">
            404
          </h1>
          <div className="flex items-center justify-center gap-2 text-xl text-gray-600 dark:text-gray-400 mb-2">
            <AlertCircle className="w-6 h-6" />
            <span>Signal Lost</span>
          </div>
        </div>

        <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
          The page you're looking for has drifted into the void.
          Try reconnecting to a known frequency.
        </p>

        <div className="flex gap-4 justify-center">
          <Link href="/" className="btn-primary">
            Return Home
          </Link>
          <Link href="/shows" className="btn-secondary">
            View Shows
          </Link>
        </div>

        {/* Static/Noise Effect */}
        <div className="mt-12 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent dark:via-gray-700 opacity-20 animate-pulse" />
          <p className="text-xs text-gray-500 dark:text-gray-600 font-mono">
            ERR_TRANSMISSION_INTERRUPTED
          </p>
        </div>
      </motion.div>
    </div>
  );
}