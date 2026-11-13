import { Logger } from '@nestjs/common';
import { SESv2Client, SendEmailCommand, SESv2ServiceException } from '@aws-sdk/client-sesv2';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  readonly name: string;
  /** Resolves with the provider's message id. Throws EmailSendError on failure. */
  send(email: OutgoingEmail): Promise<{ id: string | null }>;
}

/** `permanent` failures (rejected address, unverified sender) are not retried. */
export class EmailSendError extends Error {
  constructor(message: string, readonly permanent: boolean) {
    super(message);
    this.name = 'EmailSendError';
  }
}

export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');

/** Development: writes the email to the log instead of sending it. */
export class LogTransport implements EmailTransport {
  readonly name = 'log';
  private readonly logger = new Logger('Email');

  async send(email: OutgoingEmail) {
    this.logger.log(`[not sent] to=${email.to} subject="${email.subject}"\n${email.text}`);
    return { id: null };
  }
}

/** SES errors that will fail the same way however often they are retried. */
const PERMANENT_SES_ERRORS = new Set([
  'MessageRejected',
  'MailFromDomainNotVerifiedException',
  'AccountSuspendedException',
  'SendingPausedException',
  'BadRequestException',
  'NotFoundException',
]);

/** AWS SES v2. Credentials come from the default chain (task role, env, profile). */
export class SesTransport implements EmailTransport {
  readonly name = 'ses';
  private readonly client: SESv2Client;

  constructor(
    region: string,
    private readonly from: string,
    private readonly replyTo?: string,
    private readonly configurationSet?: string,
  ) {
    this.client = new SESv2Client({ region });
  }

  async send(email: OutgoingEmail) {
    try {
      const out = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: [email.to] },
          ReplyToAddresses: this.replyTo ? [this.replyTo] : undefined,
          ConfigurationSetName: this.configurationSet,
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: email.html, Charset: 'UTF-8' },
                Text: { Data: email.text, Charset: 'UTF-8' },
              },
            },
          },
        }),
      );
      return { id: out.MessageId ?? null };
    } catch (err) {
      if (err instanceof SESv2ServiceException) {
        throw new EmailSendError(`${err.name}: ${err.message}`, PERMANENT_SES_ERRORS.has(err.name));
      }
      throw new EmailSendError(err instanceof Error ? err.message : String(err), false);
    }
  }
}
