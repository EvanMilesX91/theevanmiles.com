import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Evan Miles - I Know You Hate It | Pre-Save',
  description:
    'Pre-save "I Know You Hate It" by Evan Miles. Out February 27, 2026.',
  openGraph: {
    title: 'Evan Miles - I Know You Hate It',
    description: 'Out February 27, 2026. Pre-save now.',
    images: [
      {
        url: 'https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/Evan%20Miles%20-%20I%20Know%20You%20Hate%20It%20(ART).jpg',
        width: 1000,
        height: 1000,
        alt: 'Evan Miles - I Know You Hate It artwork',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Evan Miles - I Know You Hate It',
    description: 'Out February 27, 2026. Pre-save now.',
    images: [
      'https://finaclzgxelyyaxoioyh.supabase.co/storage/v1/object/public/website-assets/Evan%20Miles%20-%20I%20Know%20You%20Hate%20It%20(ART).jpg',
    ],
  },
};

export default function PresaveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}