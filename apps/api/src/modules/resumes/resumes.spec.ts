import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'zlib';
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ResumeDraft } from '@asteai/types';
import { fakeDb } from '../../test-support/fakes';
import { checkDeclaredUpload, docxText, sniffResume } from './resume-files';
import { sanitizeDraft, type ResumeExtractor, type ResumeSource } from './resume-extractor';
import { ResumesService } from './resumes.service';
import { AwsCredentialProvider, presignS3Url, uriEncode } from './s3-presign';

const AWS_EXAMPLE = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };

describe('presignS3Url (SigV4)', () => {
  it('matches the AWS documentation example for a presigned GET', () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = presignS3Url({
      method: 'GET', bucket: 'examplebucket', region: 'us-east-1', key: 'test.txt', expiresInSeconds: 86_400,
      credentials: AWS_EXAMPLE, host: 'examplebucket.s3.amazonaws.com', now: new Date('2013-05-24T00:00:00Z'),
    });
    assert.equal(url,
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256'
      + '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'
      + '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host'
      + '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });

  it('signs the upload headers and the session token, and encodes the key', () => {
    const url = new URL(presignS3Url({
      method: 'PUT', bucket: 'b', region: 'ap-south-1', key: 'resumes/u1/a b.pdf', expiresInSeconds: 300,
      credentials: { ...AWS_EXAMPLE, sessionToken: 'tok/en' }, signedHeaders: { 'Content-Type': 'application/pdf', 'content-length': '10' },
      now: new Date('2026-11-14T00:00:00Z'),
    }));
    assert.equal(url.host, 'b.s3.ap-south-1.amazonaws.com');
    assert.equal(url.pathname, '/resumes/u1/a%20b.pdf');
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
    assert.equal(url.searchParams.get('X-Amz-Security-Token'), 'tok/en');
    assert.equal(uriEncode("it's (1)*!"), 'it%27s%20%281%29%2A%21');
  });

  it('uses the ECS task role when no static keys are set, and caches it', async () => {
    let calls = 0;
    const http = (async (url: string) => {
      calls++;
      assert.equal(url, 'http://169.254.170.2/v2/credentials/abc');
      return new Response(JSON.stringify({ AccessKeyId: 'ASIA', SecretAccessKey: 's', Token: 't', Expiration: new Date(Date.now() + 3_600_000).toISOString() }));
    }) as typeof fetch;
    const p = new AwsCredentialProvider((k) => ({ AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/abc' } as Record<string, string>)[k], http);
    assert.deepEqual(await p.get(), { accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 't' });
    await p.get();
    assert.equal(calls, 1);
  });
});

/** A minimal DOCX: a ZIP holding word/document.xml (deflated). */
function makeDocx(xml: string, entryName = 'word/document.xml'): Buffer {
  const name = Buffer.from(entryName);
  const raw = Buffer.from(xml);
  const data = deflateRawSync(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, data, central, name, eocd]);
}

const DOCX_XML = '<w:document><w:body><w:p><w:r><w:t>Priya Menon</w:t></w:r></w:p><w:p><w:r><w:t>Node.js &amp; Postgres</w:t></w:r></w:p></w:body></w:document>';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');

describe('résumé files', () => {
  it('accepts declared PDF/DOCX up to 5 MB whose extension matches the type', () => {
    assert.deepEqual(checkDeclaredUpload('cv.pdf', 'application/pdf', 1000), { kind: 'pdf' });
    assert.deepEqual(checkDeclaredUpload('CV.DOCX', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000), { kind: 'docx' });
    for (const [name, type, size] of [
      ['cv.doc', 'application/msword', 10], ['cv.docx', 'application/pdf', 10], ['cv.pdf', 'application/pdf', 0],
      ['cv.pdf', 'application/pdf', 5 * 1024 * 1024 + 1], ['cv.exe', 'application/octet-stream', 10],
    ] as const) {
      assert.ok('error' in checkDeclaredUpload(name, type, size), `${name} ${type} ${size}`);
    }
  });

  it('tells a real PDF and DOCX from anything else by their bytes', () => {
    assert.equal(sniffResume(PDF), 'pdf');
    assert.equal(sniffResume(makeDocx(DOCX_XML)), 'docx');
    assert.equal(sniffResume(makeDocx('<x/>', 'xl/workbook.xml')), null, 'an .xlsx is a zip too, but not a résumé');
    assert.equal(sniffResume(Buffer.from('MZ\x90\x00 not a pdf')), null);
  });

  it('extracts DOCX text as lines and decodes entities', () => {
    assert.equal(docxText(makeDocx(DOCX_XML)), 'Priya Menon\nNode.js & Postgres');
  });

  it('sanitizes the model draft: bounded lists, https links only, sane years', () => {
    const d = sanitizeDraft({
      fullName: '  Priya ', skills: ['Go', 'Go', '', 'SQL'], yearsExperience: 99.4,
      links: { linkedinUrl: 'https://linkedin.com/in/p', githubUrl: 'javascript:alert(1)', portfolioUrl: 'http://x.test' },
      experience: [{ title: 'Eng', organization: 'Acme', start: '2020', end: 'Present', highlights: ['Built X'] }],
    } as Partial<ResumeDraft>);
    assert.equal(d.fullName, 'Priya');
    assert.deepEqual(d.skills, ['Go', 'SQL']);
    assert.equal(d.yearsExperience, 60);
    assert.deepEqual(d.links, { linkedinUrl: 'https://linkedin.com/in/p', githubUrl: '', portfolioUrl: '' });
    assert.deepEqual(d.education, []);
  });
});

describe('ResumesService', () => {
  const storage = { bucket: 'resumes-bucket', region: 'ap-south-1', credentials: async () => AWS_EXAMPLE };
  const UPLOAD = '22222222-2222-4222-8222-222222222222';
  const row = (kind: 'pdf' | 'docx') => ({ id: UPLOAD, user_id: 'u1', object_key: `resumes/u1/${UPLOAD}.${kind}`, kind, size_bytes: 100 });

  function setup(opts: { kind?: 'pdf' | 'docx'; body?: Buffer; status?: number } = {}) {
    const db = fakeDb([[/FROM resume_uploads WHERE id = \$1 AND user_id = \$2/, opts.kind ? [row(opts.kind)] : []]]);
    const sources: ResumeSource[] = [];
    const extractor: ResumeExtractor = {
      extract: async (s) => {
        sources.push(s);
        return sanitizeDraft({ fullName: 'Priya Menon', skills: ['Node.js'] });
      },
    };
    const http = (async () => new Response(new Uint8Array(opts.body ?? PDF), { status: opts.status ?? 200 })) as unknown as typeof fetch;
    return { svc: new ResumesService(db.pool, storage, extractor, http), db, sources };
  }

  it('createUpload: validates, records the upload and signs a PUT bound to type and size', async () => {
    const { svc, db } = setup();
    const t = await svc.createUpload('u1', { fileName: 'cv.pdf', contentType: 'application/pdf', sizeBytes: 2048 });
    const url = new URL(t.url);
    assert.equal(t.method, 'PUT');
    assert.deepEqual(t.headers, { 'Content-Type': 'application/pdf' });
    assert.match(url.pathname, new RegExp(`^/resumes/u1/${t.uploadId}\\.pdf$`));
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
    assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
    assert.deepEqual(db.all(/INSERT INTO resume_uploads/)[0].params.slice(3), ['pdf', 'cv.pdf', 2048]);
    await assert.rejects(svc.createUpload('u1', { fileName: 'cv.pdf', contentType: 'application/pdf', sizeBytes: 6_000_000 }), BadRequestException);
  });

  it('autofill: a real PDF goes to the extractor as a document', async () => {
    const { svc, sources, db } = setup({ kind: 'pdf' });
    const out = await svc.autofill('u1', UPLOAD);
    assert.equal(out.fileKind, 'pdf');
    assert.equal(out.draft.fullName, 'Priya Menon');
    assert.equal(sources[0].kind, 'pdf');
    assert.equal(db.all(/SET status = 'parsed'/).length, 1);
  });

  it('autofill: a DOCX goes as extracted text', async () => {
    const { svc, sources } = setup({ kind: 'docx', body: makeDocx(DOCX_XML) });
    await svc.autofill('u1', UPLOAD);
    assert.deepEqual(sources[0], { kind: 'docx', text: 'Priya Menon\nNode.js & Postgres' });
  });

  it('autofill: refuses a file whose bytes are not what was declared, without calling the AI', async () => {
    const { svc, sources, db } = setup({ kind: 'pdf', body: Buffer.from('<html>not a pdf</html>') });
    await assert.rejects(svc.autofill('u1', UPLOAD), UnprocessableEntityException);
    assert.equal(sources.length, 0);
    assert.equal(db.all(/SET status = \$2/)[0].params[1], 'rejected');
  });

  it("autofill: someone else's upload, or one never uploaded to S3, is not found", async () => {
    await assert.rejects(setup().svc.autofill('u1', UPLOAD), NotFoundException);
    await assert.rejects(setup({ kind: 'pdf', status: 404 }).svc.autofill('u1', UPLOAD), NotFoundException);
    await assert.rejects(setup({ kind: 'pdf' }).svc.autofill('u1', 'not-a-uuid'), NotFoundException);
  });
});
