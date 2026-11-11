// pdfkit is `module.exports = PDFDocument`; this API compiles to CommonJS without
// esModuleInterop, so it is imported with `import = require` (typed by @types/pdfkit).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { toRenderableText } from '../certificates/certificate-pdf';
import type { Invoice } from '../ledger/billing-types';

/** Who issues the invoice (INVOICE_ISSUER_* env). Nothing is printed for unset fields. */
export interface InvoiceIssuer {
  name: string;
  address?: string;
  gstin?: string;
}

const COLOR = { ink: '#121124', muted: '#6B6E8A', line: '#DCDCEA', brand: '#2F6FE8', soft: '#F4F4FA', paid: '#059669' };

/**
 * Amounts as "INR 1,23,456.00": the standard PDF fonts have no rupee sign, and the
 * original (deeptech_backend utils/invoicePdf.js) printed "Rs." next to an 18% GST that
 * was never charged. Tax appears here only when the invoice carries a tax amount.
 */
export function pdfMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Helvetica covers WinAnsi only; names in other scripts fall back to `fallback`. */
const printable = (value: string | null | undefined, fallback: string): string =>
  (value ? toRenderableText(value) : undefined) ?? fallback;

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** A one-page A4 invoice for a captured escrow payment. */
export function renderInvoicePdf(invoice: Invoice, issuer: InvoiceIssuer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: `Invoice ${invoice.id}`, Author: issuer.name, Subject: `Escrow payment for ${invoice.contractId}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 50;
    const width = doc.page.width - 100;
    const right = left + width;
    const half = (width - 20) / 2;

    // Header band
    doc.rect(0, 0, doc.page.width, 96).fill(COLOR.brand);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text('INVOICE', left, 34, { width: half });
    doc.font('Helvetica').fontSize(10)
      .text(invoice.id, left + half + 20, 30, { width: half, align: 'right' })
      .text(`Issued ${dateText(invoice.issuedAt)}`, left + half + 20, 46, { width: half, align: 'right' })
      .font('Helvetica-Bold').text('PAID', left + half + 20, 62, { width: half, align: 'right' });

    // Issuer and bill-to
    let y = 124;
    doc.fillColor(COLOR.muted).font('Helvetica-Bold').fontSize(8)
      .text('FROM', left, y, { width: half, characterSpacing: 1 })
      .text('BILL TO', left + half + 20, y, { width: half, characterSpacing: 1 });
    y += 14;
    doc.fillColor(COLOR.ink).font('Helvetica-Bold').fontSize(11)
      .text(printable(issuer.name, 'AsteAI'), left, y, { width: half })
      .text(printable(invoice.buyerName, 'Buyer'), left + half + 20, y, { width: half });
    doc.font('Helvetica').fontSize(9).fillColor(COLOR.muted);
    const fromLines = [
      ...(issuer.address ? [printable(issuer.address, '')] : []),
      ...(issuer.gstin ? [`GSTIN: ${issuer.gstin}`] : []),
    ].filter(Boolean);
    const toLines = [...(invoice.gstin ? [`GSTIN: ${invoice.gstin}`] : [])];
    doc.text(fromLines.join('\n') || ' ', left, y + 16, { width: half });
    doc.text(toLines.join('\n') || ' ', left + half + 20, y + 16, { width: half });

    // Contract facts
    y += 64;
    const facts: [string, string][] = [
      ['Contract', invoice.contractId],
      ['Project', printable(invoice.projectTitle, invoice.contractId)],
      ['Expert', printable(invoice.expertName, 'Expert')],
      ['Payment reference', invoice.providerPaymentId ?? '-'],
    ];
    doc.rect(left, y, width, facts.length * 18 + 14).fill(COLOR.soft);
    y += 9;
    for (const [label, value] of facts) {
      doc.fillColor(COLOR.muted).font('Helvetica').fontSize(9).text(label, left + 12, y, { width: 130 });
      doc.fillColor(COLOR.ink).text(value, left + 142, y, { width: width - 154, lineBreak: false, ellipsis: true });
      y += 18;
    }

    // Line items
    y += 26;
    const amountW = 140;
    doc.rect(left, y, width, 24).fill(COLOR.ink);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9)
      .text('Description', left + 10, y + 8, { width: width - amountW - 20 })
      .text('Amount', right - amountW - 10, y + 8, { width: amountW, align: 'right' });
    y += 34;
    const description = `Escrow funding - milestone ${invoice.milestoneSeq}: ${printable(invoice.milestoneTitle, `Milestone ${invoice.milestoneSeq}`)}`;
    doc.fillColor(COLOR.ink).font('Helvetica').fontSize(10);
    const descHeight = doc.heightOfString(description, { width: width - amountW - 20 });
    doc.text(description, left + 10, y, { width: width - amountW - 20 });
    doc.text(pdfMoney(invoice.amount, invoice.currency), right - amountW - 10, y, { width: amountW, align: 'right' });
    y += Math.max(descHeight, 12) + 12;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(COLOR.line).lineWidth(1).stroke();

    // Totals
    y += 12;
    const totals: [string, string][] = [['Subtotal', pdfMoney(invoice.amount, invoice.currency)]];
    if (invoice.taxAmount != null) totals.push(['Tax', pdfMoney(invoice.taxAmount, invoice.currency)]);
    for (const [label, value] of totals) {
      doc.fillColor(COLOR.muted).font('Helvetica').fontSize(10).text(label, right - 300, y, { width: 150, align: 'right' });
      doc.fillColor(COLOR.ink).text(value, right - amountW - 10, y, { width: amountW, align: 'right' });
      y += 18;
    }
    doc.fillColor(COLOR.ink).font('Helvetica-Bold').fontSize(12)
      .text('Total paid', right - 300, y + 4, { width: 150, align: 'right' })
      .text(pdfMoney(invoice.total, invoice.currency), right - amountW - 10, y + 4, { width: amountW, align: 'right' });

    // Footer
    doc.fillColor(COLOR.muted).font('Helvetica').fontSize(8).text(
      `The amount is held in escrow by ${printable(issuer.name, 'AsteAI')} and released to the expert when the milestone is accepted. `
        + 'This is a computer-generated invoice and needs no signature.',
      left, doc.page.height - 90, { width, align: 'center' },
    );

    doc.end();
  });
}
