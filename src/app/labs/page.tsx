import type { Metadata, Viewport } from 'next';
import LabsExperience from './LabsExperience';

export const metadata: Metadata = {
  title: 'Meera Labs — Intelligence, consciously connected.',
  description:
    'Conscious Intelligence architected through a decentralised Hive Mind. Discover Meera Labs, Proof of Consciousness, and your personal companion.',
  alternates: { canonical: '/labs' },
  openGraph: {
    title: 'Meera Labs — Intelligence, consciously connected.',
    description: 'Towards decentralised Conscious Superintelligence.',
    url: '/labs',
  },
};

export default function LabsPage() {
  return <LabsExperience />;
}

export const viewport: Viewport = {
  themeColor: '#f6f5ef',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};
