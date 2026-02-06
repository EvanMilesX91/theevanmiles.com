'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Navigation() {
  const pathname = usePathname();
  const [currentTime, setCurrentTime] = useState('00:00');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
  // Include Press in styled nav pages - gets orange dot and system status
  const isStyledNav = pathname === '/' || pathname === '/mixes' || pathname === '/contact' || pathname === '/downloads' || pathname === '/press';
  
  // Check if mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close menu when route changes
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Prevent scroll when menu is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);
  
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
  ];

  // Admin link separate (hidden on mobile menu or shown differently)
  const adminLink = { name: 'Admin', href: '/admin' };

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
    <>
      <nav 
        className={`fixed top-0 left-0 right-0 z-50 ${defaultClass}`}
        style={isStyledNav ? styledNavStyles : {}}
      >
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Left: Logo + System Status */}
            <div className="flex items-center gap-4 md:gap-8">
              <Link 
                href="/" 
                className="text-lg md:text-xl font-bold tracking-widest hover:opacity-80 transition-opacity"
                style={isStyledNav ? { color: 'rgba(234, 233, 209, 0.92)' } : {}}
              >
                EVAN MILES
              </Link>
              
              {/* System Status - Desktop only */}
              {isStyledNav && (
                <div className="hidden lg:flex items-center gap-2 text-xs uppercase tracking-wider"
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

            {/* Desktop Navigation Links */}
            <ul className="hidden md:flex items-center gap-8">
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
              {/* Admin link - desktop */}
              <li>
                <Link
                  href={adminLink.href}
                  className="text-sm font-medium tracking-wide transition-all"
                  style={isStyledNav ? { 
                    color: pathname === adminLink.href 
                      ? 'rgba(234, 233, 209, 0.95)' 
                      : 'rgba(234, 233, 209, 0.65)',
                    letterSpacing: '0.02em'
                  } : {}}
                >
                  {adminLink.name}
                </Link>
              </li>
            </ul>

            {/* Mobile Hamburger Button */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden flex flex-col justify-center items-center w-10 h-10 rounded-lg transition-all"
              style={{
                border: '1px solid rgba(234, 233, 209, 0.35)',
                background: 'rgba(24, 23, 33, 0.65)',
              }}
              aria-label="Toggle menu"
            >
              <span 
                className={`block w-5 h-0.5 transition-all duration-300 ${menuOpen ? 'rotate-45 translate-y-1.5' : ''}`}
                style={{ background: 'rgba(234, 233, 209, 0.9)' }}
              />
              <span 
                className={`block w-5 h-0.5 my-1 transition-all duration-300 ${menuOpen ? 'opacity-0' : ''}`}
                style={{ background: 'rgba(234, 233, 209, 0.9)' }}
              />
              <span 
                className={`block w-5 h-0.5 transition-all duration-300 ${menuOpen ? '-rotate-45 -translate-y-1.5' : ''}`}
                style={{ background: 'rgba(234, 233, 209, 0.9)' }}
              />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      <div 
        className={`fixed inset-0 z-40 md:hidden transition-all duration-300 ${
          menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          background: 'rgba(24, 23, 33, 0.98)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div className="flex flex-col items-center justify-center h-full">
          {/* Navigation Links */}
          <ul className="flex flex-col items-center gap-8">
            {navLinks.map((link, index) => {
              const isActive = pathname === link.href;
              
              return (
                <li 
                  key={link.href}
                  className={`transition-all duration-300 ${menuOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
                  style={{ transitionDelay: `${index * 50}ms` }}
                >
                  <Link
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="relative text-2xl font-bold tracking-wide flex items-center gap-3"
                    style={{ 
                      color: isActive 
                        ? 'rgba(234, 233, 209, 0.95)' 
                        : 'rgba(234, 233, 209, 0.65)',
                      letterSpacing: '0.05em'
                    }}
                  >
                    {/* Orange indicator for active page */}
                    {isActive && (
                      <div 
                        className="w-2 h-2 rounded-full"
                        style={{ background: '#cf3a00' }}
                      />
                    )}
                    {link.name}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* System Status - Mobile Menu */}
          {isStyledNav && (
            <div 
              className={`mt-12 flex items-center gap-2 text-xs uppercase tracking-wider transition-all duration-300 ${
                menuOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
              }`}
              style={{ 
                color: 'rgba(234, 233, 209, 0.50)',
                letterSpacing: '0.08em',
                transitionDelay: '300ms'
              }}
            >
              <div 
                className="w-2 h-2 rounded-full pulse-orange"
                style={{ background: '#cf3a00' }}
              />
              <span>system online · {currentTime}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}