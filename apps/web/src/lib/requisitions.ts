import type { Requisition } from '@asteai/types';
import { apiRequest } from './api';

/** The API's largest page (see paginate() in the API). */
export const REQUISITION_PAGE_SIZE = 100;
/** Safety stop: never loop forever on a misbehaving response. */
const MAX_PAGES = 50;

/**
 * Every requisition the user can see. GET /requisitions is paginated
 * ({ data, total, page, pageSize }), so walk the pages at the maximum page size.
 */
export async function fetchAllRequisitions(): Promise<Requisition[]> {
  const all: Requisition[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await apiRequest('/requisitions', {
      method: 'GET',
      params: { page, pageSize: REQUISITION_PAGE_SIZE },
    });
    const body = (await res.json()) as { data?: Requisition[]; total?: number } | Requisition[];
    const rows = Array.isArray(body) ? body : body.data ?? [];
    all.push(...rows);
    const total = Array.isArray(body) ? undefined : body.total;
    if (rows.length < REQUISITION_PAGE_SIZE || (typeof total === 'number' && all.length >= total)) break;
  }
  return all;
}
