'use client';

import { Empty, PageHeader, Panel, Tag } from '@/components/ui';

/** Attribution needs campaign and spend data the platform does not collect yet. */
export default function MarketingReportPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Growth & Marketing"
        title="Marketing Performance & Attribution"
        sub="Acquisition channel return on investment and cost per verified candidate."
      />
      <Panel style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div><Tag color="amber">Coming soon</Tag></div>
        <Empty message="Channel attribution is not available yet: no campaign or spend data is collected, so no figures are shown." />
      </Panel>
    </div>
  );
}
