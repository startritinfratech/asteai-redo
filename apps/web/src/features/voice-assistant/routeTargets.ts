import type { UserRole, VoiceTarget } from '@asteai/types';
import { NAV } from '@/lib/routes';

/** Pages this role can open, as `route:<slug>` targets. Unbuilt ("Soon") pages are left out. */
export function routeTargets(role: UserRole): VoiceTarget[] {
  const seen = new Set<string>();
  const out: VoiceTarget[] = [];
  for (const [group, items] of NAV[role]) {
    for (const item of items) {
      if (!item.ready || seen.has(item.slug)) continue;
      seen.add(item.slug);
      out.push({ id: `route:${item.slug}`, kind: 'route', label: item.label, description: group });
    }
  }
  if (role === 'Employer' || role === 'Admin') {
    out.push({ id: 'route:hire/job-creator', kind: 'route', label: 'AI Job Creator', description: 'Draft a job and screening questions' });
  }
  return out;
}

export function routeHref(targetId: string): string {
  return `/platform/${targetId.slice('route:'.length)}`;
}
