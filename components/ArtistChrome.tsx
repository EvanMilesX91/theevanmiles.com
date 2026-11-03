'use client';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import Navigation from './Navigation';
export default function ArtistChrome(){
  const pathname = usePathname();

  if (pathname === '/waypoint' || pathname?.startsWith('/waypoint/') || pathname === '/fpl-helper') return null;

  return <><Script src="https://w.behold.so/widget.js" type="module" strategy="lazyOnload"/><Navigation/></>;
}
