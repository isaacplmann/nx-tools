import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Project View - Nx Tools',
  description: 'View and analyze Nx project metrics',
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
