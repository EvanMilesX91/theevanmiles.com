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

  return (
    <>
      <nav 
        className={`fixed top-0 left-0 right-0 z-50 ${isStyledNav ? 'nav-styled' : 'bg-black/50 backdrop-blur-md border-b border-white/50'}`}
      >
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Left: Logo */}
            <Link href="/" className="nav-logo text-lg md:text-xl font-bold tracking-widest">
              EVAN MILES
            </Link>

            {/* Center: System Status */}
            {isStyledNav && (
              <div className="nav-status flex items-center gap-2 text-xs uppercase tracking-wider">
                <div className="w-2 h-2 rounded-full pulse-orange" style={{ background: '#cf3a00' }} />
                <span className="hidden sm:inline">system online · </span>
                <span>{currentTime}</span>
              </div>
            )}

            {/* Right: Desktop Navigation Links */}
            <ul className="hidden md:flex items-center gap-8">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={`nav-link text-sm font-medium tracking-wide flex items-center gap-2 ${isActive ? 'active' : ''}`}
                    >
                      {isActive && <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#cf3a00' }} />}
                      {link.name}
                    </Link>
                  </li>
                );
              })}
              <li>
                <Link href={adminLink.href} className={`nav-link text-sm font-medium tracking-wide ${pathname === adminLink.href ? 'active' : ''}`}>
                  {adminLink.name}
                </Link>
              </li>
            </ul>

            {/* Right: Mobile Hamburger Button */}
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="hamburger-btn md:hidden flex items-center justify-center w-10 h-10 rounded-lg"
              aria-label="Toggle menu"
            >
              {menuOpen ? (
                <span className="text-lg font-bold">X</span>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="hamburger-line"></span>
                  <span className="hamburger-line"></span>
                  <span className="hamburger-line"></span>
                </div>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      {menuOpen && (
        <div className="mobile-menu fixed inset-0 md:hidden" onClick={() => setMenuOpen(false)}>
          <div className="flex flex-col items-center justify-center h-full" onClick={(e) => e.stopPropagation()}>
            <ul className="flex flex-col items-center gap-8">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className={`mobile-nav-link text-2xl font-bold tracking-wide flex items-center gap-3 py-3 px-6 ${isActive ? 'active' : ''}`}
                    >
                      {isActive && <div className="w-2 h-2 rounded-full" style={{ background: '#cf3a00' }} />}
                      {link.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <style jsx>{`
        .nav-styled {
          background: rgba(24, 23, 33, 0.65);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(234, 233, 209, 0.25);
        }
        .nav-logo {
          color: rgba(234, 233, 209, 0.92);
          transition: opacity 0.2s;
        }
        .nav-logo:hover {
          opacity: 0.8;
        }
        .nav-status {
          color: rgba(234, 233, 209, 0.50);
          letter-spacing: 0.08em;
        }
        .nav-link {
          color: rgba(234, 233, 209, 0.65);
          transition: color 0.2s;
        }
        .nav-link:hover,
        .nav-link.active {
          color: rgba(234, 233, 209, 0.95);
        }
        .hamburger-btn {
          border: 1px solid rgba(234, 233, 209, 0.35);
          background: rgba(24, 23, 33, 0.85);
          color: rgba(234, 233, 209, 0.9);
          position: relative;
          z-index: 100;
        }
        .hamburger-line {
          display: block;
          width: 18px;
          height: 2px;
          background: rgba(234, 233, 209, 0.9);
        }
        .mobile-menu {
          background: rgba(24, 23, 33, 0.98);
          backdrop-filter: blur(20px);
          z-index: 90;
        }
        .mobile-nav-link {
          color: rgba(234, 233, 209, 0.65);
          letter-spacing: 0.05em;
        }
        .mobile-nav-link.active {
          color: rgba(234, 233, 209, 0.95);
        }
      `}</style>
    </>
  );
}