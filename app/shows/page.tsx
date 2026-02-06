'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, MapPin, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Show } from '@/lib/types';
import { format } from 'date-fns';
import Image from 'next/image';

export default function ShowsPage() {
  const [upcomingShows, setUpcomingShows] = useState<Show[]>([]);
  const [pastShows, setPastShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchShows();
  }, []);

  async function fetchShows() {
    const { data, error } = await supabase
      .from('shows')
      .select('*')
      .order('date', { ascending: false });

    if (data) {
      const now = new Date();
      setUpcomingShows(data.filter(s => new Date(s.date) >= now && s.status === 'upcoming'));
      setPastShows(data.filter(s => new Date(s.date) < now || s.status === 'past'));
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-2xl">Loading shows...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-20 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16"
        >
          <h1 className="text-5xl md:text-6xl font-bold mb-4">Live Shows</h1>
          <p className="text-xl text-gray-600 dark:text-gray-400">
            Catch me bringing the frequencies to life
          </p>
        </motion.div>

        {/* Upcoming Shows */}
        {upcomingShows.length > 0 && (
          <section className="mb-20">
            <h2 className="text-3xl font-bold mb-8">Upcoming</h2>
            <div className="space-y-6">
              {upcomingShows.map((show, index) => (
                <motion.div
                  key={show.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="card flex flex-col md:flex-row gap-6"
                >
                  {show.poster_url && (
                    <div className="w-full md:w-48 h-48 relative rounded-lg overflow-hidden flex-shrink-0">
                      <Image
                        src={show.poster_url}
                        alt={`${show.venue} poster`}
                        fill
                        className="object-cover"
                      />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-2xl font-bold mb-2">{show.venue}</h3>
                        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 mb-2">
                          <MapPin className="w-4 h-4" />
                          <span>{show.city}{show.country && `, ${show.country}`}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                          <Calendar className="w-4 h-4" />
                          <span>{format(new Date(show.date), 'MMMM d, yyyy - h:mm a')}</span>
                        </div>
                      </div>
                    </div>
                    {show.video_url && (
                      <a
                        href={show.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Watch recap
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </section>
        )}

        {/* Past Shows */}
        {pastShows.length > 0 && (
          <section>
            <h2 className="text-3xl font-bold mb-8">Past Shows</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {pastShows.map((show, index) => (
                <motion.div
                  key={show.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.05 }}
                  className="card"
                >
                  {show.poster_url && (
                    <div className="w-full h-48 relative rounded-lg overflow-hidden mb-4">
                      <Image
                        src={show.poster_url}
                        alt={`${show.venue} poster`}
                        fill
                        className="object-cover"
                      />
                    </div>
                  )}
                  <h3 className="text-xl font-bold mb-2">{show.venue}</h3>
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                    {show.city}{show.country && `, ${show.country}`}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-500">
                    {format(new Date(show.date), 'MMMM d, yyyy')}
                  </div>
                  {show.video_url && (
                    <a
                      href={show.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline mt-3"
                    >
                      Watch recap
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </motion.div>
              ))}
            </div>
          </section>
        )}

        {upcomingShows.length === 0 && pastShows.length === 0 && (
          <div className="text-center py-20">
            <p className="text-xl text-gray-600 dark:text-gray-400">
              No shows scheduled yet. Check back soon!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}