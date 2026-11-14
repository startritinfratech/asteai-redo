import { createHash, createHmac } from 'crypto';

/**
 * AWS Signature V4 query-string presigning for S3 (no SDK: the API has no S3 client
 * installed, and presigning is a small, fully specified algorithm). Checked against
 * AWS's published example in s3-presign.spec.ts.
 *
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface PresignInput {
  method: 'GET' | 'PUT';
  bucket: string;
  region: string;
  key: string;
  expiresInSeconds: number;
  credentials: AwsCredentials;
  /** Headers the uploader must send with exactly these values (lowercase names). */
  signedHeaders?: Record<string, string>;
  /** Defaults to the virtual-hosted endpoint `<bucket>.s3.<region>.amazonaws.com`. */
  host?: string;
  now?: Date;
}

/** RFC 3986 encoding as SigV4 wants it (encodeURIComponent leaves !'()* alone). */
export function uriEncode(s: string, keepSlash = false): string {
  const out = encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? out.replace(/%2F/g, '/') : out;
}

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s, 'utf8').digest();

export function amzDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function presignS3Url(input: PresignInput): string {
  if (input.expiresInSeconds < 1 || input.expiresInSeconds > 604_800) throw new RangeError('expires must be 1s–7d');
  const now = input.now ?? new Date();
  const datetime = amzDate(now);
  const date = datetime.slice(0, 8);
  const host = input.host ?? `${input.bucket}.s3.${input.region}.amazonaws.com`;
  const scope = `${date}/${input.region}/s3/aws4_request`;

  const headers: Record<string, string> = { host, ...lowerKeys(input.signedHeaders ?? {}) };
  const headerNames = Object.keys(headers).sort();
  const signedHeaderList = headerNames.join(';');

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': datetime,
    'X-Amz-Expires': String(input.expiresInSeconds),
    'X-Amz-SignedHeaders': signedHeaderList,
  };
  if (input.credentials.sessionToken) query['X-Amz-Security-Token'] = input.credentials.sessionToken;
  const canonicalQuery = Object.keys(query).sort().map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`).join('&');

  const path = `/${uriEncode(input.key.replace(/^\/+/, ''), true)}`;
  const canonicalRequest = [
    input.method,
    path,
    canonicalQuery,
    headerNames.map((h) => `${h}:${headers[h].trim()}\n`).join(''),
    signedHeaderList,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', datetime, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, date);
  const kSigning = hmac(hmac(hmac(kDate, input.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
}

/**
 * Credentials from the environment, or from the ECS task role (the container credentials
 * endpoint), cached until shortly before they expire.
 */
export class AwsCredentialProvider {
  private cached: { creds: AwsCredentials; expiresAt: number } | null = null;

  constructor(private readonly env: (k: string) => string | undefined, private readonly http: typeof fetch = fetch) {}

  async get(): Promise<AwsCredentials> {
    const id = this.env('AWS_ACCESS_KEY_ID');
    const secret = this.env('AWS_SECRET_ACCESS_KEY');
    if (id && secret) return { accessKeyId: id, secretAccessKey: secret, sessionToken: this.env('AWS_SESSION_TOKEN') || undefined };

    if (this.cached && this.cached.expiresAt - Date.now() > 5 * 60_000) return this.cached.creds;
    const relative = this.env('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI');
    const full = this.env('AWS_CONTAINER_CREDENTIALS_FULL_URI');
    const url = relative ? `http://169.254.170.2${relative}` : full;
    if (!url) throw new Error('No AWS credentials (set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or run with a task role)');
    const token = this.env('AWS_CONTAINER_AUTHORIZATION_TOKEN');
    const res = await this.http(url, { headers: token ? { Authorization: token } : {}, signal: AbortSignal.timeout(3_000) });
    if (!res.ok) throw new Error(`Container credentials endpoint answered ${res.status}`);
    const body = (await res.json()) as { AccessKeyId: string; SecretAccessKey: string; Token?: string; Expiration?: string };
    const creds = { accessKeyId: body.AccessKeyId, secretAccessKey: body.SecretAccessKey, sessionToken: body.Token };
    this.cached = { creds, expiresAt: body.Expiration ? Date.parse(body.Expiration) : Date.now() + 15 * 60_000 };
    return creds;
  }
}
