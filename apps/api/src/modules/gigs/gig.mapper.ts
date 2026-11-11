import { GIG_AUTO_ACCEPT_DAYS } from '@asteai/types';
import type {
  AdminServiceItem, GigDelivery, GigOrder, GigOrderStatus, MyService, PackageTier, ServiceCard, ServiceDetail,
  ServicePackage, ServiceStatus,
} from '@asteai/types';
import { publicName } from './gig-rules';

type Num = string | number;
type Ts = Date | string | null;

const iso = (v: Ts): string | null => (v == null ? null : new Date(v).toISOString());

export interface PackageRow {
  id: string;
  service_id: string;
  tier: PackageTier;
  name: string;
  description: string;
  price: Num;
  delivery_days: number;
  revisions: number;
  features: string[];
}

export interface ServiceRow {
  id: string;
  expert_id: string;
  title: string;
  slug: string;
  category: string;
  summary: string;
  description: string;
  tags: string[];
  status: ServiceStatus;
  admin_note: string | null;
  rating: Num;
  review_count: number;
  created_at: Ts;
  updated_at: Ts;
  // joined
  first_name?: string | null;
  last_name?: string | null;
  expert_rating?: Num | null;
  from_price?: Num | null;
  from_days?: number | null;
  total?: Num;
}

export interface OrderRow {
  id: string;
  service_id: string;
  package_id: string;
  buyer_id: string;
  expert_id: string;
  requirements: string;
  price: Num;
  delivery_days: number;
  revisions: number;
  contract_id: string | null;
  status: GigOrderStatus;
  due_at: Ts;
  delivered_at: Ts;
  reminder_sent_at?: Ts;
  overdue_notified_at?: Ts;
  accepted_terms_at: Ts;
  created_at: Ts;
  service_title: string;
  service_slug: string;
  package_name: string;
  package_tier: PackageTier;
  buyer_name: string | null;
  expert_name: string | null;
  contract_status: string | null;
  milestone_status: string | null;
  revisions_used: number | null;
  reviewed: boolean | null;
}

export interface DeliveryRow {
  id: string;
  note: string;
  links: string[];
  created_at: Ts;
}

export function mapPackage(r: PackageRow): ServicePackage {
  return {
    id: r.id, tier: r.tier, name: r.name, description: r.description, price: Number(r.price),
    deliveryDays: Number(r.delivery_days), revisions: Number(r.revisions), features: r.features ?? [],
  };
}

const TIER_ORDER: Record<PackageTier, number> = { basic: 0, standard: 1, premium: 2 };
export const byTier = (a: PackageRow, b: PackageRow) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier];

/** A public card. Deliberately has no email, expert id, admin note or status. */
export function mapCard(r: ServiceRow): ServiceCard {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    category: r.category,
    summary: r.summary,
    tags: r.tags ?? [],
    expertName: publicName(r.first_name, r.last_name),
    expertRating: Number(r.expert_rating ?? 0),
    rating: Number(r.rating),
    reviewCount: Number(r.review_count),
    fromPrice: Number(r.from_price ?? 0),
    fromDays: Number(r.from_days ?? 0),
  };
}

export function mapDetail(r: ServiceRow, packages: PackageRow[], isOwner: boolean): ServiceDetail {
  const sorted = [...packages].sort(byTier).map(mapPackage);
  const cheapest = [...sorted].sort((a, b) => a.price - b.price)[0];
  return {
    ...mapCard({ ...r, from_price: cheapest?.price ?? 0, from_days: cheapest?.deliveryDays ?? 0 }),
    description: r.description,
    status: r.status,
    packages: sorted,
    isOwner,
  };
}

export function mapMine(r: ServiceRow, packages: PackageRow[]): MyService {
  return {
    id: r.id, slug: r.slug, title: r.title, category: r.category, summary: r.summary, description: r.description,
    tags: r.tags ?? [], status: r.status, adminNote: r.admin_note, rating: Number(r.rating),
    reviewCount: Number(r.review_count), packages: [...packages].sort(byTier).map(mapPackage),
    createdAt: iso(r.created_at) ?? '', updatedAt: iso(r.updated_at) ?? '',
  };
}

export function mapAdminItem(r: ServiceRow, packages: PackageRow[]): AdminServiceItem {
  return {
    ...mapMine(r, packages),
    expertId: r.expert_id,
    expertName: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'AsteAI expert',
  };
}

export function mapDelivery(r: DeliveryRow): GigDelivery {
  return { id: r.id, note: r.note, links: r.links ?? [], createdAt: iso(r.created_at) ?? '' };
}

/** Delivered and still waiting for the buyer (no dispute): the order that will be accepted automatically. */
const isAwaitingReview = (r: OrderRow) => r.milestone_status === 'submitted' && r.contract_status !== 'disputed';

export function mapOrder(r: OrderRow, deliveries?: DeliveryRow[], now = Date.now()): GigOrder {
  const deliveredAt = iso(r.delivered_at);
  const dueAt = iso(r.due_at);
  return {
    id: r.id,
    serviceId: r.service_id,
    serviceTitle: r.service_title,
    serviceSlug: r.service_slug,
    packageId: r.package_id,
    packageName: r.package_name,
    packageTier: r.package_tier,
    buyerId: r.buyer_id,
    buyerName: r.buyer_name ?? '',
    expertId: r.expert_id,
    expertName: r.expert_name ?? '',
    requirements: r.requirements,
    price: Number(r.price),
    deliveryDays: Number(r.delivery_days),
    revisions: Number(r.revisions),
    revisionsUsed: Number(r.revisions_used ?? 0),
    contractId: r.contract_id,
    contractStatus: r.contract_status,
    milestoneStatus: r.milestone_status,
    status: r.status,
    dueAt,
    deliveredAt,
    autoAcceptAt: deliveredAt && isAwaitingReview(r)
      ? new Date(new Date(deliveredAt).getTime() + GIG_AUTO_ACCEPT_DAYS * 86_400_000).toISOString() : null,
    overdue: Boolean(dueAt) && new Date(dueAt as string).getTime() < now
      && (r.milestone_status === 'funded' || r.milestone_status === 'revision_requested'),
    acceptedTermsAt: iso(r.accepted_terms_at) ?? '',
    createdAt: iso(r.created_at) ?? '',
    reviewed: Boolean(r.reviewed),
    ...(deliveries ? { deliveries: deliveries.map(mapDelivery) } : {}),
  };
}
