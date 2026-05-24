'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function TopNav() {
  const pathname = usePathname();
  const hideStartParty = pathname.startsWith('/party/');

  return (
    <nav className="top-nav">
      <div className="app-frame nav-inner">
        <Link className="nav-logo" href="/">urTheDJ</Link>
        {!hideStartParty ? <Link className="btn secondary nav-cta" href="/admin/create-party">Start a Party</Link> : null}
      </div>
    </nav>
  );
}
