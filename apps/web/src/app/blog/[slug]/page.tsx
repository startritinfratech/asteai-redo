import type { Metadata } from 'next';
import { shareMeta } from '@/features/marketing/shareMeta';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatPublished, getPost, POSTS } from '@/features/content';
import { JsonLd } from '@/features/marketing/JsonLd';
import { absolute, breadcrumbLd } from '@/features/marketing/structuredData';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import { renderMarkdown } from '@/features/marketing/legal/markdown';
import legal from '@/features/marketing/legal/legal.module.css';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

export const dynamicParams = false;

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = getPost(params.slug);
  if (!post) return {};
  return {
    title: { absolute: `${post.title} — ASTEAI Journal` },
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    ...shareMeta({ title: post.title, description: post.excerpt, type: 'article', publishedTime: post.publishedAt, tags: post.tags, image: false }),
  };
}

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) notFound();
  const { body } = renderMarkdown(post.content);

  return (
    <PageShell>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: post.title,
          description: post.excerpt,
          datePublished: post.publishedAt,
          author: { '@type': 'Organization', name: post.author },
          publisher: { '@type': 'Organization', name: 'ASTEAI' },
          keywords: post.tags.join(', '),
          mainEntityOfPage: absolute(`/blog/${post.slug}`),
          image: absolute(`/blog/${post.slug}/opengraph-image`),
        }}
      />
      <JsonLd data={breadcrumbLd([{ name: 'Blog', path: '/blog' }, { name: post.title, path: `/blog/${post.slug}` }])} />
      <PageHero
        eyebrow={post.category}
        title={post.title}
        meta={
          <>
            <time dateTime={post.publishedAt}>{formatPublished(post.publishedAt)}</time>
            <span>{post.readTime} min read</span>
            <span>{post.author}</span>
          </>
        }
      />
      <div className={marketing.container}>
        <article className={`${s.article} ${legal.prose}`} aria-labelledby="page-title">
          {body}
          <footer className={s.articleFoot}>
            <ul className={s.tags} aria-label="Tags">
              {post.tags.map((t) => <li key={t} className={`${s.pill} ${s.pillGrey}`}>{t}</li>)}
            </ul>
            <p style={{ marginTop: 20 }}>
              <Link href="/blog" className={marketing.textLink}>← All posts</Link>
            </p>
          </footer>
        </article>
      </div>
    </PageShell>
  );
}
