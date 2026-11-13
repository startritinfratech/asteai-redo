import type { LegalSlug } from '../documents';
import cancellation from './cancellation';
import cookies from './cookies';
import doNotSell from './do-not-sell';
import dpa from './dpa';
import msa from './msa';
import privacy from './privacy';
import refunds from './refunds';
import terms from './terms';
import vendor from './vendor';

/** Markdown source of each legal document, as published on the production site. */
export const LEGAL_SOURCES: Record<LegalSlug, string> = {
  terms,
  privacy,
  cookies,
  refunds,
  cancellation,
  dpa,
  msa,
  vendor,
  'do-not-sell': doNotSell,
};
