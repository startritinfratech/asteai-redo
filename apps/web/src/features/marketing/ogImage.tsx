/**
 * Shared look for generated Open Graph images (1200×630). Uses next/og's default font so the
 * image renders without fetching web fonts at request time.
 */
import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

export function ogCard({ eyebrow, title, footer }: { eyebrow: string; title: string; footer?: string }): ImageResponse {
  const size = title.length > 70 ? 54 : title.length > 40 ? 64 : 76;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          padding: '64px 72px', background: 'linear-gradient(135deg, #03010A 0%, #0A0914 55%, #1A1440 100%)', color: '#F4F4FA',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, #4D8BFF, #7C5CFF)' }} />
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 6 }}>ASTEAI</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 26, color: '#7FB0FF', letterSpacing: 4, textTransform: 'uppercase' }}>{eyebrow}</div>
          <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1.1, maxWidth: 1050 }}>{title}</div>
        </div>
        <div style={{ fontSize: 26, color: '#A3A5BE' }}>{footer ?? 'Hiring, delivered · asteai.com'}</div>
      </div>
    ),
    OG_SIZE,
  );
}
