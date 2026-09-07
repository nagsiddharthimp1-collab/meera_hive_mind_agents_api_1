'use client';

import { MeeraRewardsDialog } from '@/components/MeeraRewardsDialog';
import { useRouter } from 'next/navigation';

export default function MeeraRewardsPage() {
  const router = useRouter();

  return (
    <main className="h-[100dvh] overflow-hidden bg-background text-primary">
      <MeeraRewardsDialog isOpen onClose={() => router.push('/')} />
    </main>
  );
}
