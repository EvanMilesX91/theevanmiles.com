'use client';
import { usePathname } from 'next/navigation';
import Script from 'next/script';
import Navigation from './Navigation';
export default function ArtistChrome(){
  const pathname=usePathname();
  if(pathname==='/waypoint'||pathname?.startsWith('/waypoint/'))return null;
  return <><Script src="https://w.behold.so/widget.js" type="module" strategy="lazyOnload"/><Navigation/></>;
}
