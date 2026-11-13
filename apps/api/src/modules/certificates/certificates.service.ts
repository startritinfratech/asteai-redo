import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_POOL } from '../../database/database.module';
import { AiService } from '../ai/ai.service';
import {
  CertificateContent,
  certificateContentFromAssessment,
  withAssessedScores,
} from './certificate-content';
import { generateProfessionalCertificate, toRenderableText } from './certificate-pdf';

/** deeptech_ai refuses to write a certificate for fewer turns than this. */
const MIN_SCOREABLE_TURNS = 3;

interface MockInterviewRow {
  id: string;
  user_id: string;
  skill: string;
  domain: string;
  summary: string;
  language: string;
  status: string;
  turns: number;
  ended_reason: string | null;
  conversation: unknown[];
  proctoring_summary: Record<string, unknown>;
  certificate_content: CertificateContent | null;
  started_at: string;
  candidate_name: string | null;
}

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly ai: AiService,
  ) {}

  private async load(id: string): Promise<MockInterviewRow | null> {
    const { rows } = await this.db.query(
      `SELECT m.*, NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS candidate_name
         FROM mock_interviews m JOIN user_accounts u ON u.id = m.user_id
        WHERE m.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /**
   * Certificate content, from the first of:
   *  1. what the interview's own summary wrote (the mock summarizer emits
   *     certificate_content alongside the scores — the usual case);
   *  2. deeptech_ai's certificate writer, given the transcript;
   *  3. the recorded assessment alone, which invents nothing.
   */
  async buildContent(row: MockInterviewRow): Promise<{ content: CertificateContent; source: 'ai' | 'assessment' }> {
    const fromSummary = row.proctoring_summary?.certificate_content;
    if (fromSummary && typeof fromSummary === 'object' && !Array.isArray(fromSummary)) {
      return { content: fromSummary as CertificateContent, source: 'ai' };
    }
    if ((row.turns ?? 0) >= MIN_SCOREABLE_TURNS) {
      try {
        const res = await this.ai.post<{ success: boolean; certificate_content?: CertificateContent }>(
          '/api/voice/certificate/generate-content-inline',
          {
            record_id: row.id,
            conversation: row.conversation ?? [],
            turn_count: row.turns,
            ended_reason: row.ended_reason,
            language: row.language,
            candidate_name: row.candidate_name,
            skills: [row.skill].filter(Boolean),
            domains: [row.domain].filter(Boolean),
            experience_summary: row.summary ?? '',
          },
          undefined,
          60_000,
        );
        if (res?.success && res.certificate_content) return { content: res.certificate_content, source: 'ai' };
        this.logger.warn(`AI returned no certificate content for ${row.id}`);
      } catch (err) {
        this.logger.warn(`Certificate content service unavailable for ${row.id}; using the assessment: ${err instanceof Error ? err.message : err}`);
      }
    }
    return { content: certificateContentFromAssessment(row), source: 'assessment' };
  }

  /** The stored content, generating and storing it on first use. */
  async ensureContent(id: string, regenerate = false): Promise<{ row: MockInterviewRow; content: CertificateContent }> {
    const row = await this.load(id);
    if (!row) throw new NotFoundException('Interview not found');
    if (row.certificate_content && !regenerate) return { row, content: row.certificate_content };

    const { content, source } = await this.buildContent(row);
    try {
      await this.db.query(
        `UPDATE mock_interviews
            SET certificate_content = $2::jsonb, certificate_source = $3,
                certificate_generated_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [id, JSON.stringify(content), source],
      );
    } catch (err) {
      // A failed write must not cost the candidate the certificate; it is rebuilt next time.
      this.logger.error(`Could not store certificate content for ${id}: ${err instanceof Error ? err.message : err}`);
    }
    return { row, content };
  }

  /** The finished certificate payload the PDF prints. */
  printable(row: MockInterviewRow, content: CertificateContent): CertificateContent {
    // The account name wins unless the PDF fonts cannot print its script; then the
    // assessment's romanized copy is used.
    const name = [row.candidate_name, content.candidate_name].find(
      (n): n is string => typeof n === 'string' && Boolean(toRenderableText(n.trim())),
    );
    const out = withAssessedScores({ ...content, candidate_name: name || 'Candidate', record_id: row.id }, row.proctoring_summary);
    out.interview_date = new Date(row.started_at).toLocaleDateString('en-US', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    return out;
  }

  async pdf(id: string): Promise<Buffer> {
    const { row, content } = await this.ensureContent(id);
    return generateProfessionalCertificate(this.printable(row, content));
  }

  /** Public check behind the QR code / verify link. Says nothing beyond the certificate. */
  async verify(id: string) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(id)) return { valid: false, message: 'Certificate not found' };
    const row = await this.load(id);
    if (!row || row.status !== 'completed') return { valid: false, message: 'Certificate not found' };
    if (!row.certificate_content) {
      return { valid: false, message: 'No certificate has been issued for this interview' };
    }
    const cc = row.certificate_content;
    return {
      valid: true,
      certificateId: row.id,
      candidateName: row.candidate_name || cc.candidate_name || 'Candidate',
      certificateTitle: cc.certificate_title || 'AI Interview Assessment',
      recommendation: cc.recommendation || null,
      domainsDemonstrated: Array.isArray(cc.domains_demonstrated) ? cc.domains_demonstrated : [],
      interviewDate: row.started_at,
      verifiedAt: new Date().toISOString(),
    };
  }
}
