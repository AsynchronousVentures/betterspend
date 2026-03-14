import type { Metadata } from 'next';
import { Manrope, Space_Grotesk } from 'next/font/google';
import AppShell from '../components/app-shell';
import { ToastProvider } from '../components/toast';
import { PwaRegister } from '../components/pwa-register';
import './globals.css';

const sans = Manrope({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const display = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'BetterSpend',
  description: 'Open Source Purchase Order Management',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'BetterSpend',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <head>
        <meta name="theme-color" content="#dd5b38" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="font-sans">
        <PwaRegister />
        <ToastProvider>
          <AppShell>
            {children}
          </AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
