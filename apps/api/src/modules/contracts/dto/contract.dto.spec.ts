import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateContractDto } from './contract.dto';

const body = (currency?: string) => ({
  proposalId: 'PR-1', engagementModel: 'fixed', paymentTerms: { totalAmount: 100 }, ndaRequired: false,
  milestones: [{ title: 'M1', amount: 100 }], ...(currency ? { currency } : {}),
});
const pipe = new ValidationPipe({ transform: true, whitelist: true });
const run = (b: object) => pipe.transform(b, { type: 'body', metatype: CreateContractDto });

describe('CreateContractDto.currency', () => {
  it('refuses a currency the wallet, payouts and invoices cannot handle with 400', async () => {
    await assert.rejects(run(body('USD')), (e: BadRequestException) => e.getStatus() === 400 && /currency must be one of: INR/.test(JSON.stringify(e.getResponse())));
  });

  it('accepts INR and the default (omitted)', async () => {
    assert.equal(((await run(body('INR'))) as CreateContractDto).currency, 'INR');
    assert.equal(((await run(body())) as CreateContractDto).currency, undefined);
  });
});
