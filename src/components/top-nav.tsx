'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function TopNav() {
  const pathname = usePathname();
  const hideStartParty = pathname.startsWith('/party/');
  const isHome = pathname === '/';

  return (
    <nav className="top-nav">
      <div className="app-frame nav-inner">
        <Link className="nav-logo" href="/">urTheDJ</Link>
        {!hideStartParty ? (
          <Link className="btn secondary nav-cta" href={isHome ? '/signup' : '/admin/create-party'}>
            {isHome ? 'Sign Up' : 'Start a Party'}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
