export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

/** Normalises untrusted page / pageSize query values into safe, bounded integers. */
export function paginate(page: unknown, pageSize: unknown, defaultSize = 20, maxSize = 100): Pagination {
  const p = Math.max(1, Math.floor(Number(page)) || 1);
  const size = Math.min(maxSize, Math.max(1, Math.floor(Number(pageSize)) || defaultSize));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}
