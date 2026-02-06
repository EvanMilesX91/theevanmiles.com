'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Navigation() {
  const pathname = usePathname();
  const [currentTime, setCurrentTime] = useState('00:00');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  // Include Press in styled nav pages - gets orange dot and system status
  const isStyledNav = pathname === '/' || pathname === '/mixes' || pathname === '/contact' || pathname === '/downloads' || pathname === '/press';
  
  // Check if mobile and set mounted
  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    setMounted(true);
    
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
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

  // Admin link separate
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

  // Don't render mobile-specific elements until mounted to prevent flickering
  if (!mounted) {
    return (
      <nav 
        className={`fixed top-0 left-0 right-0 z-50 ${defaultClass}`}
        style={isStyledNav ? styledNavStyles : {}}
      >
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex items-center justify-between h-16">
            <Link 
              href="/" 
              className="text-lg md:text-xl font-bold tracking-widest hover:opacity-80 transition-opacity"
              style={isStyledNav ? { color: 'rgba(234, 233, 209, 0.92)' } : {}}
            >
              EVAN MILES
            </Link>
          </div>
        </div>
      </nav>
    );
  }

  return (
    <>
      <nav 
        className={`fixed top-0 left-0 right-0 z-50 ${defaultClass}`}
        style={isStyledNav ? styledNavStyles : {}}
      >
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Left: Logo */}
            <Link 
              href="/" 
              className="text-lg md:text-xl font-bold tracking-widest hover:opacity-80 transition-opacity"
              style={isStyledNav ? { color: 'rgba(234, 233, 209, 0.92)' } : {}}
            >
              EVAN MILES
            </Link>

            {/* Center: System Status - Shows on all screen sizes for styled nav */}
            {isStyledNav && (
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider"
                style={{ 
                  color: 'rgba(234, 233, 209, 0.50)',
                  letterSpacing: '0.08em'
                }}>
                <div 
                  className="w-2 h-2 rounded-full pulse-orange"
                  style={{ background: '#cf3a00' }}
                />
                <span className="hidden sm:inline">system online · </span>
                <span>{currentTime}</span>
              </div>
            )}

            {/* Right: Desktop Navigation Links */}
            <ul className="hidden md:flex items-center gap-8">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                
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

            {/* Right: Mobile Hamburger Button */}
            {isMobile && (
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex flex-col justify-center items-center w-10 h-10 rounded-lg transition-all relative z-[100]"
                style={{
                  border: '1px solid rgba(234, 233, 209, 0.35)',
                  background: 'rgba(24, 23, 33, 0.85)',
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
            )}
          </div>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      {isMobile && menuOpen && (
        <div 
          className="fixed inset-0 z-[90]"
          style={{
            background: 'rgba(24, 23, 33, 0.98)',
            backdropFilter: 'blur(20px)',
          }}
          onClick={() => setMenuOpen(false)}
        >
          <div 
            className="flex flex-col items-center justify-center h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Navigation Links */}
            <ul className="flex flex-col items-center gap-8">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className="relative text-2xl font-bold tracking-wide flex items-center gap-3 py-2 px-4"
                      style={{ 
                        color: isActive 
                          ? 'rgba(234, 233, 209, 0.95)' 
                          : 'rgba(234, 233, 209, 0.65)',
                        letterSpacing: '0.05em'
                      }}
                    >
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
          </div>
        </div>
      )}
    </>
  );
}