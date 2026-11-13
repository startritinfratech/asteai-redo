/** Editorial content (blog posts, case studies), ported from the legacy SPA's data files. */
export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  /** Markdown. */
  content: string;
  author: string;
  /** ISO date (YYYY-MM-DD). */
  publishedAt: string;
  category: string;
  tags: string[];
  featuredImage?: string;
  /** Minutes. */
  readTime: number;
}

export interface CaseStudyResult {
  metric: string;
  label: string;
}

export interface CaseStudy extends Omit<BlogPost, 'author'> {
  client: string;
  industry: string;
  results: CaseStudyResult[];
  expertDomain: string;
  engagementModel: string;
}
