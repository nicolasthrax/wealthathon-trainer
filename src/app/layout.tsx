import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthGate } from '@/components/AuthGate';

export const metadata: Metadata = {
  title: 'Wealthathon Trainer',
  description: 'Practice simulator for the BOCHK x HKU Business School Wealthathon Challenge.',
};
export const viewport: Viewport = { themeColor: '#080b10', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><AuthGate>{children}</AuthGate></body>
    </html>
  );
}
