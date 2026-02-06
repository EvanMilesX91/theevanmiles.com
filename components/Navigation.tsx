'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Navigation() {
  const pathname = usePathname();
  const [currentTime, setCurrentTime] = useState('00:00');
  
  // Include Press in styled nav pages - gets orange dot and system status
  const isStyledNav = pathname === '/' || pathname === '/mixes' || pathname === '/contact' || pathname === '/downloads' || pathname === '/press';
  
  // Update time for system status
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}`);
    };
    
    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  const navLinks = [
    { name: 'Home', href: '/' },
    { name: 'Mixes', href: '/mixes' },
    { name: 'Downloads', href: '/downloads' },
    { name: 'Press', href: '/press' },
    { name: 'Contact', href: '/contact' },
    { name: 'Admin', href: '/admin' },
  ];

  // Auto-logout when navigating away from admin area
  useEffect(() => {
    if (pathname && !pathname.startsWith('/admin')) {
      const wasAuthenticated = localStorage.getItem('admin_authenticated');
      if (wasAuthenticated) {
        localStorage.removeItem('admin_authenticated');
        console.log('Auto-logged out from admin');
      }
    }
  }, [pathname]);

  // Styled nav styling
  const styledNavStyles = isStyledNav ? {
    background: 'rgba(24, 23, 33, 0.65)',
    backdropFilter: 'blur(12px)',
    borderBottom: '1px solid rgba(234, 233, 209, 0.25)'
  } : {};

  // Default styling for other pages
  const defaultClass = isStyledNav ? '' : 'bg-black/50 backdrop-blur-md border-b border-white/50';

  return (
    <nav 
      className={`fixed top-0 left-0 right-0 z-50 ${defaultClass}`}
      style={isStyledNav ? styledNavStyles : {}}
    >
      <div className="container mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Left: Logo + System Status */}
          <div className="flex items-center gap-8">
            <Link 
              href="/" 
              className="text-xl font-bold tracking-widest hover:opacity-80 transition-opacity"
              style={isStyledNav ? { color: 'rgba(234, 233, 209, 0.92)' } : {}}
            >
              EVAN MILES
            </Link>
            
            {/* System Status - Styled nav pages */}
            {isStyledNav && (
              <div className="hidden md:flex items-center gap-2 text-xs uppercase tracking-wider"
                style={{ 
                  color: 'rgba(234, 233, 209, 0.50)',
                  letterSpacing: '0.08em'
                }}>
                <div 
                  className="w-2 h-2 rounded-full pulse-orange"
                  style={{ background: '#cf3a00' }}
                />
                <span>system online · last sync {currentTime}</span>
              </div>
            )}
          </div>

          {/* Navigation Links */}
          <ul className="flex items-center gap-8">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              
              // Styled nav styling
              if (isStyledNav) {
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="relative text-sm font-medium tracking-wide transition-all duration-300 flex items-center gap-2"
                      style={{ 
                        color: isActive 
                          ? 'rgba(234, 233, 209, 0.95)' 
                          : 'rgba(234, 233, 209, 0.65)',
                        letterSpacing: '0.02em'
                      }}
                    >
                      {/* Orange indicator for active page */}
                      {isActive && (
                        <div 
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: '#cf3a00' }}
                        />
                      )}
                      {link.name}
                    </Link>
                  </li>
                );
              }
              
              // Default styling for other pages
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`text-sm font-medium tracking-wide transition-all ${
                      isActive
                        ? 'text-white'
                        : 'text-white/70 hover:text-white/90'
                    }`}
                  >
                    {link.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}