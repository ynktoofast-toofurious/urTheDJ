import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { TopNav } from '@/components/top-nav';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800', '900'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'urTheDJ',
  description: 'Nightlife-ready party playlist and request system for DJs and guests.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <TopNav />
        <div className="page-shell">{children}</div>
      </body>
    </html>
  );
}
