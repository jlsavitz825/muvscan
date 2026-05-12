import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800', '900'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MüvScan — AI Vision Scanner',
  description:
    'Scan your home with AI vision and build a complete moving inventory in minutes. Powered by MÜV — Move Smart. Breathe Easy.',
  applicationName: 'MüvScan',
  authors: [{ name: 'MÜV' }],
  keywords: ['moving', 'AI', 'inventory', 'home scanner', 'MÜV', 'computer vision'],
  themeColor: '#061628',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'MüvScan',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: '/favicon.png',
    apple: '/apple-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#061628',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
