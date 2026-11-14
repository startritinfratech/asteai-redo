import {
  BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { ResumeAutofillResult, ResumeUploadTicket } from '@asteai/types';
import { DB_POOL } from '../../database/database.module';
import { checkDeclaredUpload, docxText, MAX_RESUME_BYTES, RESUME_TYPES, sniffResume } from './resume-files';
import { RESUME_EXTRACTOR, type ResumeExtractor } from './resume-extractor';
import { presignS3Url, type AwsCredentials } from './s3-presign';

export const RESUME_STORAGE = 'RESUME_STORAGE';

export interface ResumeStorageConfig {
  bucket: string;
  region: string;
  credentials: () => Promise<AwsCredentials>;
}

const UPLOAD_URL_TTL = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UploadRow {
  id: string;
  user_id: string;
  object_key: string;
  kind: 'pdf' | 'docx';
  size_bytes: number;
}

/**
 * Résumés go browser → S3 directly (presigned PUT, valid 5 minutes, signed for the
 * declared type and exact size), so the API never proxies the file. Autofill then reads
 * the object back, checks the bytes really are that PDF/DOCX, and asks the extractor for
 * a draft the user reviews before anything is saved.
 */
@Injectable()
export class ResumesService {
  private readonly logger = new Logger(ResumesService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    @Optional() @Inject(RESUME_STORAGE) private readonly storage: ResumeStorageConfig | null,
    @Optional() @Inject(RESUME_EXTRACTOR) private readonly extractor: ResumeExtractor | null,
    private readonly http: typeof fetch = fetch,
  ) {}

  private requireStorage(): ResumeStorageConfig {
    if (!this.storage) throw new ServiceUnavailableException('Résumé uploads are not configured (RESUME_BUCKET)');
    return this.storage;
  }

  async createUpload(userId: string, input: { fileName: string; contentType: string; sizeBytes: number }): Promise<ResumeUploadTicket> {
    const storage = this.requireStorage();
    const checked = checkDeclaredUpload(input.fileName, input.contentType, input.sizeBytes);
    if ('error' in checked) throw new BadRequestException(checked.error);

    const id = randomUUID();
    const key = `resumes/${userId}/${id}.${RESUME_TYPES[checked.kind].ext}`;
    await this.db.query(
      `INSERT INTO resume_uploads (id, user_id, object_key, kind, file_name, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId, key, checked.kind, input.fileName.slice(0, 200), input.sizeBytes],
    );
    const headers = { 'Content-Type': RESUME_TYPES[checked.kind].mime };
    const url = presignS3Url({
      method: 'PUT', bucket: storage.bucket, region: storage.region, key, expiresInSeconds: UPLOAD_URL_TTL,
      credentials: await storage.credentials(),
      // Signed: S3 refuses the PUT unless type and length are exactly what was declared.
      signedHeaders: { 'content-type': headers['Content-Type'], 'content-length': String(input.sizeBytes) },
    });
    return { uploadId: id, url, method: 'PUT', headers, expiresInSeconds: UPLOAD_URL_TTL };
  }

  /** Reads the upload back from S3 and returns the extractor's draft. Metered by the controller. */
  async autofill(userId: string, uploadId: string): Promise<ResumeAutofillResult> {
    const storage = this.requireStorage();
    if (!this.extractor) throw new ServiceUnavailableException('Autofill is not configured (ANTHROPIC_API_KEY)');
    if (!UUID.test(uploadId)) throw new NotFoundException('Upload not found');
    const { rows } = await this.db.query<UploadRow>(
      `SELECT id, user_id, object_key, kind, size_bytes FROM resume_uploads WHERE id = $1 AND user_id = $2`, [uploadId, userId],
    );
    const upload = rows[0];
    if (!upload) throw new NotFoundException('Upload not found');

    const bytes = await this.download(storage, upload.object_key);
    const actual = sniffResume(bytes);
    if (!actual || actual !== upload.kind) {
      await this.mark(upload.id, 'rejected');
      throw new UnprocessableEntityException(`That file is not a readable ${upload.kind.toUpperCase()}`);
    }
    let draft;
    if (actual === 'pdf') {
      draft = await this.extractor.extract({ kind: 'pdf', bytes });
    } else {
      const text = docxText(bytes);
      if (!text) {
        await this.mark(upload.id, 'rejected');
        throw new UnprocessableEntityException('No text could be read from that Word file');
      }
      draft = await this.extractor.extract({ kind: 'docx', text });
    }
    await this.db.query(
      `UPDATE resume_uploads SET status = 'parsed', autofill = $2::jsonb, parsed_at = NOW() WHERE id = $1`,
      [upload.id, JSON.stringify(draft)],
    );
    return { uploadId: upload.id, fileKind: actual, draft };
  }

  async latest(userId: string) {
    const { rows } = await this.db.query(
      `SELECT id, kind, file_name, size_bytes, status, autofill, created_at, parsed_at FROM resume_uploads
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const r = rows[0];
    return r ? {
      uploadId: r.id, fileKind: r.kind, fileName: r.file_name, sizeBytes: Number(r.size_bytes), status: r.status,
      draft: r.autofill, uploadedAt: r.created_at, parsedAt: r.parsed_at,
    } : null;
  }

  private async download(storage: ResumeStorageConfig, key: string): Promise<Buffer> {
    const url = presignS3Url({
      method: 'GET', bucket: storage.bucket, region: storage.region, key, expiresInSeconds: 60, credentials: await storage.credentials(),
    });
    let res: Response;
    try {
      res = await this.http(url, { signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new ServiceUnavailableException('The résumé store is unreachable');
    }
    if (res.status === 404 || res.status === 403) throw new NotFoundException('Upload the file first');
    if (!res.ok) throw new ServiceUnavailableException(`The résumé store answered ${res.status}`);
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_RESUME_BYTES) throw new UnprocessableEntityException('The file is larger than 5 MB');
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_RESUME_BYTES) throw new UnprocessableEntityException('The file is larger than 5 MB');
    return bytes;
  }

  private async mark(id: string, status: 'rejected' | 'parsed') {
    await this.db.query(`UPDATE resume_uploads SET status = $2 WHERE id = $1`, [id, status]).catch((err: unknown) =>
      this.logger.warn(`Could not mark upload ${id}: ${err instanceof Error ? err.message : err}`));
  }
}
