import { blogPosts } from './blogPosts';
import { caseStudies } from './caseStudies';
import type { BlogPost, CaseStudy } from './types';

export type { BlogPost, CaseStudy, CaseStudyResult } from './types';

const byDateDesc = <T extends { publishedAt: string }>(a: T, b: T) => b.publishedAt.localeCompare(a.publishedAt);

export const POSTS: readonly BlogPost[] = [...blogPosts].sort(byDateDesc);
export const CASE_STUDIES: readonly CaseStudy[] = [...caseStudies].sort(byDateDesc);

export const getPost = (slug: string) => POSTS.find((p) => p.slug === slug);
export const getCaseStudy = (slug: string) => CASE_STUDIES.find((c) => c.slug === slug);

export function formatPublished(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { dateStyle: 'long', timeZone: 'UTC' });
}
