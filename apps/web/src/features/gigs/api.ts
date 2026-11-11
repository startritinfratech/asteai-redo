import type {
  AdminServiceItem, CreateOrderInput, GigOrder, MyService, PackageInput, ServiceDetail, ServiceInput, ServicePage,
  ServiceStatus,
} from '@asteai/types';
import { api } from '@/lib/api';

const id = encodeURIComponent;

export const gigsApi = {
  // Experts
  mine: () => api.get<MyService[]>('/services/mine'),
  create: (input: ServiceInput) => api.post<MyService>('/services', input),
  update: (sid: string, input: ServiceInput) => api.put<MyService>(`/services/${id(sid)}`, input),
  setPackages: (sid: string, packages: PackageInput[]) => api.post<MyService>(`/services/${id(sid)}/packages`, { packages }),
  submit: (sid: string) => api.post<MyService>(`/services/${id(sid)}/submit`),
  pause: (sid: string) => api.post<MyService>(`/services/${id(sid)}/pause`),
  resume: (sid: string) => api.post<MyService>(`/services/${id(sid)}/resume`),
  // Admin
  queue: (status: ServiceStatus) => api.get<AdminServiceItem[]>('/admin/services', { status }),
  decide: (sid: string, status: 'published' | 'rejected', note?: string) =>
    api.patch<AdminServiceItem>(`/admin/services/${id(sid)}/status`, { status, note }),
  // Public
  detail: (slug: string) => api.get<ServiceDetail>(`/services/${id(slug)}`),
  // Orders
  order: (input: CreateOrderInput) => api.post<GigOrder>('/orders', input),
  deliver: (oid: string, note: string, links: string[]) => api.post<GigOrder>(`/orders/${id(oid)}/deliver`, { note, links }),
  requestRevision: (oid: string, note: string) => api.post<GigOrder>(`/orders/${id(oid)}/request-revision`, { note }),
  accept: (oid: string) => api.post<GigOrder>(`/orders/${id(oid)}/accept`),
  cancel: (oid: string) => api.post<GigOrder>(`/orders/${id(oid)}/cancel`),
  review: (oid: string, rating: number, comment: string) => api.post<GigOrder>(`/orders/${id(oid)}/review`, { rating, comment }),
};

export type { ServicePage };
export const orderKey = (oid: string) => `/orders/${id(oid)}`;
