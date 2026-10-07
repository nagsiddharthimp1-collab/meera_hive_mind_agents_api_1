'use client';

import { LiveAPIProvider } from '@/contexts/LiveAPIContext';
import { MeeraVoice } from './index';

const voiceOptions = { apiKey: '' };

export default function VoiceSession(props: React.ComponentProps<typeof MeeraVoice>) {
  return <LiveAPIProvider options={voiceOptions}><MeeraVoice {...props} /></LiveAPIProvider>;
}
