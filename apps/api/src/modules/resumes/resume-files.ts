import { inflateRawSync } from 'zlib';

/**
 * Resume file rules and parsing (resume-files.spec.ts). The browser's declared type is
 * only a hint: what decides is the file's own bytes, read back from S3 after upload.
 */

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export const RESUME_TYPES = {
  pdf: { mime: 'application/pdf', ext: 'pdf' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
} as const;
export type ResumeKind = keyof typeof RESUME_TYPES;

/** The declared upload, checked before a URL is signed. Returns the kind or an error message. */
export function checkDeclaredUpload(fileName: string, contentType: string, sizeBytes: number): { kind: ResumeKind } | { error: string } {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const kind = (Object.keys(RESUME_TYPES) as ResumeKind[]).find((k) => RESUME_TYPES[k].mime === contentType);
  if (!kind) return { error: 'Upload a PDF or Word (.docx) file' };
  if (RESUME_TYPES[kind].ext !== ext) return { error: `A ${kind.toUpperCase()} file should end in .${RESUME_TYPES[kind].ext}` };
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1) return { error: 'The file is empty' };
  if (sizeBytes > MAX_RESUME_BYTES) return { error: 'The file is larger than 5 MB' };
  return { kind };
}

/** What the bytes actually are. A DOCX is a ZIP that contains word/document.xml. */
export function sniffResume(bytes: Buffer): ResumeKind | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return findZipEntry(bytes, 'word/document.xml') ? 'docx' : null;
  }
  return null;
}

interface ZipEntry { method: number; compressedSize: number; uncompressedSize: number; localOffset: number }

/** Minimal ZIP central-directory reader: enough to find one entry. */
function findZipEntry(zip: Buffer, name: string): ZipEntry | null {
  // End of central directory record: signature 0x06054b50, within the last 64 KB + 22 bytes.
  const min = Math.max(0, zip.length - 65_557);
  let eocd = -1;
  for (let i = zip.length - 22; i >= min; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const entries = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const uncompressedSize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    if (zip.toString('utf8', p + 46, p + 46 + nameLen) === name) return { method, compressedSize, uncompressedSize, localOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** Most text a résumé could reasonably expand to; anything bigger is refused (zip bomb). */
const MAX_DOCX_XML = 10 * 1024 * 1024;

/** The plain text of a DOCX (paragraphs as lines), or null if it can't be read. */
export function docxText(zip: Buffer): string | null {
  const e = findZipEntry(zip, 'word/document.xml');
  if (!e || e.uncompressedSize > MAX_DOCX_XML) return null;
  const lh = e.localOffset;
  if (lh + 30 > zip.length || zip.readUInt32LE(lh) !== 0x04034b50) return null;
  const start = lh + 30 + zip.readUInt16LE(lh + 26) + zip.readUInt16LE(lh + 28);
  const data = zip.subarray(start, start + e.compressedSize);
  let xml: string;
  try {
    xml = (e.method === 0 ? data : e.method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_DOCX_XML }) : null)?.toString('utf8') ?? '';
  } catch {
    return null;
  }
  if (!xml) return null;
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
