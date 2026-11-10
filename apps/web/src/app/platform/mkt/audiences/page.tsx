'use client';

import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';

/**
 * Audience segments have no backend yet. Rather than showing invented segments and
 * "creating" new ones in local state, the page says plainly that it is coming soon.
 */
export default function MarketingAudiencesPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Growth & Marketing"
        title="Audience Segments"
        sub="Build skill-indexed audience segments for re-targeting and outbound outreach."
        actions={
          <Button variant="primary" disabled>
            + Create Segment (coming soon)
          </Button>
        }
      />
      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div><Tag color="amber">Coming soon</Tag></div>
        <Empty message="Audience segments are not available yet. Nothing has been created or saved." />
      </Panel>
    </div>
  );
}
