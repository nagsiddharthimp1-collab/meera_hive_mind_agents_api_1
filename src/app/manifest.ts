import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  const appName = process.env.NEXT_PUBLIC_APP_NAME;
  return {
    name: `${appName} OS`,
    short_name: `${appName} OS`,
    description: "India's AI",
    start_url: '/',
    display: 'standalone',
    background_color: '#0c3c26',
    theme_color: '#0c3c26',
    icons: [
      {
        src: '/icons/favicon-196.png',
        sizes: '196x196',
        type: 'image/png',
      },
      {
        src: '/icons/manifest-icon-192.maskable.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/manifest-icon-512.maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/apple-icon-180.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
