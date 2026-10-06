'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

// The public Labs experience does not use authentication, voice, or app state.
// Load those services only on application routes.
const ApplicationProviders = dynamic(() => import('./ApplicationProviders'));

export default function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/labs') return <>{children}</>;
  return <ApplicationProviders>{children}</ApplicationProviders>;
}
