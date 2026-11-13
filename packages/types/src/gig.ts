// ─── Gigs (pre-packaged services) ────────────────────────────────────────────
// Shared by apps/api (modules/gigs) and apps/web (features/gigs). Re-exported from ./index.

export const SERVICE_STATUSES = ['draft', 'pending', 'published', 'paused', 'rejected'] as const;
export type ServiceStatus = typeof SERVICE_STATUSES[number];

export const PACKAGE_TIERS = ['basic', 'standard', 'premium'] as const;
export type PackageTier = typeof PACKAGE_TIERS[number];

export const SERVICE_CATEGORIES = [
  'AI / ML', 'Software engineering', 'Security & compliance', 'Data engineering', 'Cloud & DevOps',
  'Design', 'Writing & research', 'Other',
] as const;

export const SERVICE_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'rating'] as const;
export type ServiceSort = typeof SERVICE_SORTS[number];

export const GIG_ORDER_STATUSES = [
  'awaiting_payment', 'in_progress', 'delivered', 'revision_requested', 'completed', 'cancelled',
] as const;
export type GigOrderStatus = typeof GIG_ORDER_STATUSES[number];

export const GIG_LIMITS = {
  title: 120, summary: 300, description: 5000, tags: 10, tag: 30, packageName: 80, packageDescription: 1000,
  features: 10, feature: 120, maxPrice: 10_000_000, requirements: 4000, deliveryNote: 4000, links: 10, review: 2000,
} as const;

export interface ServicePackage {
  id: string;
  tier: PackageTier;
  name: string;
  description: string;
  price: number;
  deliveryDays: number;
  revisions: number;
  features: string[];
}

/** Public card: never carries an email; the expert is "First L.". */
export interface ServiceCard {
  id: string;
  slug: string;
  title: string;
  category: string;
  summary: string;
  tags: string[];
  expertName: string;
  expertRating: number;
  rating: number;
  reviewCount: number;
  /** Lowest package price and its delivery time. */
  fromPrice: number;
  fromDays: number;
}

export interface ServicePage {
  items: ServiceCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ServiceDetail extends ServiceCard {
  description: string;
  status: ServiceStatus;
  packages: ServicePackage[];
  /** True when the signed-in caller owns it (owner preview of an unpublished service). */
  isOwner: boolean;
}

/** The expert's own view (GET /services/mine) and the admin queue. */
export interface MyService {
  id: string;
  slug: string;
  title: string;
  category: string;
  summary: string;
  description: string;
  tags: string[];
  status: ServiceStatus;
  adminNote: string | null;
  rating: number;
  reviewCount: number;
  packages: ServicePackage[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminServiceItem extends MyService {
  expertId: string;
  expertName: string;
}

export interface ServiceInput {
  title: string;
  category: string;
  summary: string;
  description: string;
  tags: string[];
}

export interface PackageInput {
  tier: PackageTier;
  name: string;
  description?: string;
  price: number;
  deliveryDays: number;
  revisions: number;
  features: string[];
}

export interface GigDelivery {
  id: string;
  note: string;
  links: string[];
  createdAt: string;
}

/** A delivered order nobody reviews is reminded after this many days, and accepted automatically after the second. */
export const GIG_REMINDER_DAYS = 5;
export const GIG_AUTO_ACCEPT_DAYS = 7;

export interface GigOrder {
  id: string;
  serviceId: string;
  serviceTitle: string;
  serviceSlug: string;
  packageId: string;
  packageName: string;
  packageTier: PackageTier;
  buyerId: string;
  buyerName: string;
  expertId: string;
  expertName: string;
  requirements: string;
  price: number;
  deliveryDays: number;
  revisions: number;
  /** Revisions the buyer has used so far. */
  revisionsUsed: number;
  contractId: string | null;
  contractStatus: string | null;
  milestoneStatus: string | null;
  status: GigOrderStatus;
  dueAt: string | null;
  deliveredAt: string | null;
  /** When a delivered order is accepted automatically (deliveredAt + GIG_AUTO_ACCEPT_DAYS); null otherwise. */
  autoAcceptAt: string | null;
  /** A funded order past its due date that the expert has not delivered. */
  overdue: boolean;
  acceptedTermsAt: string;
  createdAt: string;
  /** Present on GET /orders/:id. */
  deliveries?: GigDelivery[];
  /** The buyer's review of the service for this order, once left. */
  reviewed?: boolean;
}

export interface CreateOrderInput {
  packageId: string;
  requirements: string;
  acceptTerms: true;
}

/** Gig order status for a contract milestone status (mirrors the trigger in migration 014). */
export function gigOrderStatusFor(milestoneStatus: string): GigOrderStatus {
  switch (milestoneStatus) {
    case 'pending': return 'awaiting_payment';
    case 'funded': return 'in_progress';
    case 'submitted':
    case 'accepted': return 'delivered';
    case 'revision_requested': return 'revision_requested';
    case 'released': return 'completed';
    default: return 'cancelled';
  }
}
