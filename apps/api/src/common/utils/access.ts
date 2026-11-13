import { ForbiddenException } from '@nestjs/common';
import type { User } from '@asteai/types';

/** Admins see everything; everyone else only rows that belong to their own tenant. */
export function assertTenantAccess(user: Pick<User, 'role' | 'tenantId'>, tenantId: string | null): void {
  if (user.role === 'Admin') return;
  if (!user.tenantId || user.tenantId !== tenantId) throw new ForbiddenException();
}
