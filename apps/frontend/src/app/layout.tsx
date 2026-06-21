import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'StreamEngine 24/7 - YouTube Live Controller',
  description: 'Robust 24/7 automated playlist live streaming controller for YouTube Live',
  viewport: 'width=device-width, initial-scale=1'
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
