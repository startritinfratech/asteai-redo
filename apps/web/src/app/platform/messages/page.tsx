'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/ui';
import { MessagesView } from '@/features/messaging';

export default function MessagesPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <PageHeader
        eyebrow="Inbox"
        title="Messages"
        sub="Talk to the people you work with. Keep contact details and payments on AsteAI so escrow protects both sides."
      />
      {/* useSearchParams() needs a Suspense boundary in the App Router. */}
      <Suspense fallback={null}>
        <MessagesView />
      </Suspense>
    </div>
  );
}
