import type { Metadata } from 'next';
import './globals.css';
const origin =
  'https://gwl-production-meter-intelligence.speedy-pika-9425.chatgpt.site';
export const metadata: Metadata = {
  title: 'GWL | Production Meter Intelligence',
  description:
    'Controlled meter identity discovery, production telemetry and reporting health for Ghana Water Limited.',
  metadataBase: new URL(origin),
  openGraph: {
    title: 'GWL | Production Meter Intelligence',
    description: 'Discover. Validate. Monitor.',
    images: [
      {
        url: origin + '/og.png',
        width: 1735,
        height: 907,
        alt: 'GWL Production Meter Intelligence',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GWL | Production Meter Intelligence',
    description: 'Discover. Validate. Monitor.',
    images: [origin + '/og.png'],
  },
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
