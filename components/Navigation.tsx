'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Navigation() {
  const pathname = usePathname();
  const [currentTime, setCurrentTime] = useState('00:00');
  const [menuOpen, setMenuOpen] = useState(false);
  
  const isStyledNav = pathname === '/' || pathname === '/mixes' || pathname === '/contact' || pathname === '/downloads' || pathname === '/press';

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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

  const adminLink = { name: 'Admin', href: '/admin' };

  useEffect(() => {
    if (pathname && !pathname.startsWith('/admin')) {
      const wasAuthenticated = localStorage.getItem('admin_authenticated');
      if (wasAuthenticated) {
        localStorage.removeItem('admin_authenticated');
      }
    }
  }, [pathname]);

  const styledNavStyles = isStyledNav ? {
    background: 'rgba(24, 23, 33, 0.65)',
    backdropFilter: 'blur(12px)',
    borderBottom: '1px solid rgba(234, 233, 209, 0.25)'
  } : {};

  const defaultClass = isStyledNav ? '' : 'bg-black/50 backdrop-blur-md border-b border-white/50';

  return (
    <>
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

            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg relative z-[100]"
              style={{
                border: '1px solid rgba(234, 233, 209, 0.35)',
                background: 'rgba(24, 23, 33, 0.85)',
              }}
              aria-label="Toggle menu"
            >
              <span 
                className="text-xl font-light"
                style={{ color: 'rgba(234, 233, 209, 0.9)' }}
              >
                {menuOpen ? 'X' : '☰'}
              </span>
            </button>
          </div>
        </div>
      </nav>

      {menuOpen && (
        <div 
          className="fixed inset-0 z-[90] md:hidden"
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
            <ul className="flex flex-col items-center gap-8">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className="relative text-2xl font-bold tracking-wide flex items-center gap-3 py-3 px-6"
                      style={{ 
                        color: isActive 
                          ? 'rgba(234, 233, 209, 0.95)' 
                          : 'rgba(234, 233, 209, 0.65)',
                        letterSpacing: '0.05em',
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