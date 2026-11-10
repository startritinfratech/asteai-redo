'use client';

import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';

/**
 * Marketing campaigns have no backend yet (no ad-channel integration, no metrics), so
 * the page shows no invented campaigns or numbers and creating one is disabled.
 * Recruiter outreach campaigns live under Outreach.
 */
export default function MarketingCampaignsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Growth & Marketing"
        title="Marketing Campaigns"
        sub="Track paid advertising channels, cost per acquisition and candidate growth."
        actions={
          <Button variant="primary" disabled>
            + Create Campaign (coming soon)
          </Button>
        }
      />
      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div><Tag color="amber">Coming soon</Tag></div>
        <Empty message="Ad campaign tracking is not connected yet, so there are no campaigns or metrics to show." />
      </Panel>
    </div>
  );
}
