import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { User } from '@asteai/types';
import type { NotificationsService } from '../notifications/notifications.service';
import { fakeDb, type Route } from '../../test-support/fakes';
import { submitProblem } from './product-rules';
import { ProductsService } from './products.service';
import type { ProductDto } from './dto/product.dto';

const seller = { id: 'u-seller', role: 'Freelancer' } as User;
const stranger = { id: 'u-x', role: 'Freelancer' } as User;

const product = (over: Record<string, unknown> = {}) => ({
  id: 'PRD-AAAA1111', seller_id: 'u-seller', slug: 'kit-aaaa1111', title: 'Kit', summary: 'A '.repeat(15),
  description: 'D'.repeat(100), category: 'Code', tags: ['nextjs'], price_minor: 99900, currency: 'INR', license: 'single_team',
  file_key: null, status: 'draft', review_note: null, published_at: null, updated_at: new Date(), first_name: 'Aarav', last_name: 'Sharma',
  ...over,
});

const dto: ProductDto = {
  title: 'Kit', summary: 's', description: 'd', category: 'Code', tags: ['a', ' A ', 'b'], priceMinor: 99900, license: 'single_team',
};

function setup(routes: Route[]) {
  const db = fakeDb(routes);
  const sent: string[] = [];
  const notifications = { send: async (userId: string, text: string) => { sent.push(`${userId}:${text}`); return {}; } } as unknown as NotificationsService;
  return { db, sent, svc: new ProductsService(db.pool, notifications) };
}

describe('product rules', () => {
  it('lists what blocks submission', () => {
    assert.match(submitProblem({ summary: 'short', description: 'x'.repeat(100), tags: ['a'] })!, /summary/);
    assert.match(submitProblem({ summary: 'x'.repeat(30), description: 'short', tags: ['a'] })!, /description/);
    assert.match(submitProblem({ summary: 'x'.repeat(30), description: 'x'.repeat(100), tags: [] })!, /tag/);
    assert.equal(submitProblem({ summary: 'x'.repeat(30), description: 'x'.repeat(100), tags: ['a'] }), null);
  });
});

describe('ProductsService public reads', () => {
  it('lists only active products and shows a privacy-safe seller name', async () => {
    const { svc, db } = setup([[/FROM products p JOIN user_accounts/, [{ ...product({ status: 'active' }), total: '1' }]]]);
    const page = await svc.list({ q: 'kit' }, { page: 1, pageSize: 24, offset: 0 });
    assert.match(db.log[0].sql, /p\.status = 'active'/);
    assert.equal(page.items[0].sellerName, 'Aarav S.');
    assert.equal(page.total, 1);
    assert.ok(!('fileKey' in page.items[0]) && !('file_key' in page.items[0]));
  });

  it('404s a slug that is not active', async () => {
    const { svc } = setup([]);
    await assert.rejects(svc.bySlug('nope'), NotFoundException);
  });
});

describe('ProductsService seller lifecycle', () => {
  it('creates a draft with a unique slug and de-duplicated tags', async () => {
    const { svc, db } = setup([[/INSERT INTO products/, (p) => [product({ slug: p[2], tags: p[7] })]]]);
    const out = await svc.create(dto, seller);
    const params = db.log[0].params;
    assert.match(params[0] as string, /^PRD-/);
    assert.match(params[2] as string, /^kit-[0-9a-z]{8}$/);
    assert.deepEqual(params[7], ['a', 'b']);
    assert.equal(out.status, 'draft');
  });

  it('hides other sellers’ products as 404', async () => {
    const { svc } = setup([[/FOR UPDATE/, [product()]]]);
    await assert.rejects(svc.update('PRD-AAAA1111', dto, stranger), NotFoundException);
  });

  it('refuses edits while pending or active', async () => {
    for (const status of ['pending', 'active']) {
      const { svc } = setup([[/FOR UPDATE/, [product({ status })]]]);
      await assert.rejects(svc.update('PRD-AAAA1111', dto, seller), ConflictException);
    }
  });

  it('submission needs an approved expert profile and a complete listing, then notifies admins', async () => {
    const notApproved = setup([[/FOR UPDATE/, [product()]], [/FROM expert_profiles/, [{ status: 'pending' }]]]);
    await assert.rejects(notApproved.svc.move('PRD-AAAA1111', 'submit', seller), ForbiddenException);

    const incomplete = setup([[/FOR UPDATE/, [product({ tags: [] })]], [/FROM expert_profiles/, [{ status: 'approved' }]]]);
    await assert.rejects(incomplete.svc.move('PRD-AAAA1111', 'submit', seller), BadRequestException);

    const ok = setup([
      [/FOR UPDATE/, [product()]],
      [/FROM expert_profiles/, [{ status: 'approved' }]],
      [/UPDATE products SET status/, (p) => [product({ status: p[1] })]],
      [/role = 'Admin'/, [{ id: 'admin-1' }]],
    ]);
    assert.equal((await ok.svc.move('PRD-AAAA1111', 'submit', seller)).status, 'pending');
    assert.equal(ok.sent.length, 1);
  });

  it('cannot pause a draft', async () => {
    const { svc } = setup([[/FOR UPDATE/, [product()]]]);
    await assert.rejects(svc.move('PRD-AAAA1111', 'pause', seller), ConflictException);
  });
});

describe('ProductsService admin review', () => {
  it('requires a note to reject', async () => {
    await assert.rejects(setup([]).svc.review('PRD-1', 'rejected', undefined), BadRequestException);
  });

  it('only reviews pending products, and tells the seller', async () => {
    const none = setup([]);
    await assert.rejects(none.svc.review('PRD-1', 'active', undefined), ConflictException);
    const ok = setup([[/UPDATE products SET status/, [product({ status: 'active', published_at: new Date() })]]]);
    assert.equal((await ok.svc.review('PRD-1', 'active', undefined)).status, 'active');
    assert.match(ok.sent[0], /^u-seller:.*is live/);
  });
});
