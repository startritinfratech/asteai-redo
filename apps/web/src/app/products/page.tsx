import type { Metadata } from 'next';
import Link from 'next/link';
import type { ProductCard, ProductPage } from '@asteai/types';
import { EmptyState } from '@/components/ui';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';
import { ApiNotFound, ApiUnavailable, serverGet } from '@/lib/serverApi';

export const metadata: Metadata = {
  title: 'AI Solutions Catalog',
  description: 'Ready-made models, codebases, blueprints and APIs from verified experts, licensed for your team.',
  alternates: { canonical: '/products' },
};

const price = (p: ProductCard) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: p.currency || 'INR', maximumFractionDigits: 0 }).format(p.priceMinor / 100);

export default async function ProductsPage() {
  let data: ProductPage | null = null;
  let failed = false;
  try {
    data = await serverGet<ProductPage>('/products', { revalidate: 300 });
  } catch (err) {
    if (!(err instanceof ApiUnavailable || err instanceof ApiNotFound)) throw err;
    failed = true;
  }

  return (
    <PageShell>
      <PageHero eyebrow="Digital products" title="AI solutions catalog">
        Ready-made models, codebases, blueprints and APIs from verified experts, licensed for your team.
      </PageHero>
      <section className={`${marketing.container} ${s.listSection}`} aria-label="Products">
        {failed && (
          <div className={s.notice} role="alert">
            <strong>The catalog is temporarily unavailable.</strong> In the meantime, browse{' '}
            <Link href="/services" className={marketing.textLink}>pre-packaged services</Link>.
          </div>
        )}
        {data && data.items.length === 0 && (
          <EmptyState title="No products listed yet" action={<Link href="/services" className={marketing.textLink}>Browse services</Link>}>
            Experts are preparing their first listings.
          </EmptyState>
        )}
        {data && data.items.length > 0 && (
          <ul className={`${s.grid} ${s.grid3}`}>
            {data.items.map((p) => (
              <li key={p.id} className={s.card}>
                <span className={s.pill}>{p.category}</span>
                <h2 className={s.cardTitle}>{p.title}</h2>
                <p className={s.cardText}>{p.summary}</p>
                <div className={s.cardFoot}>
                  <span className={s.muted}>by <b>{p.sellerName}</b></span>
                  <span className={`${s.pill} ${s.pillMint}`}>{price(p)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
