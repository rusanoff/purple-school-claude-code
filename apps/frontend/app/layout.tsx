import type { Metadata } from 'next';

import { APP_NAME } from '@/components/brand';

import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Schedule and run your team meetings.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
