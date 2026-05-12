import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MüvScan — AI Vision Scanner',
    short_name: 'MüvScan',
    description: 'Scan your home with AI vision and build a complete moving inventory in minutes.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#030D18',
    theme_color: '#061628',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    categories: ['utilities', 'productivity', 'lifestyle'],
  };
}
