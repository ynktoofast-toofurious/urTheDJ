import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'urTheDJ',
  description: 'Nightlife-ready party playlist and request system for DJs and guests.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="page-shell">{children}</div>
      </body>
    </html>
  );
}
