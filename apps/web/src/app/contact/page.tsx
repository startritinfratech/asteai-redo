import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import { REGISTER_PATH } from '@/features/marketing/AuthAwareActions';
import marketing from '@/features/marketing/marketing.module.css';
import page from '@/features/marketing/pages.module.css';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with ASTEAI — general inquiries, experts, clients and technical support.',
  alternates: { canonical: '/contact' },
};

const SUPPORT_EMAIL = 'supportasteai@startrit.com';

// Content as published on the production "Contact Us" page.
const CHANNELS = [
  {
    title: 'General Inquiries',
    text: 'For general questions about ASTEAI, partnership opportunities, or media inquiries, please reach out to us at:',
    email: true,
  },
  {
    title: 'For Experts',
    text: 'Are you a deep-tech expert looking to join our platform? We’re always looking for talented individuals in AI, robotics, semiconductors, quantum computing, and other cutting-edge fields.',
    link: { href: `${REGISTER_PATH}?role=Freelancer`, label: 'Sign up as an expert' },
  },
  {
    title: 'For Clients',
    text: 'Looking to hire top-tier deep-tech talent for your projects? Our platform makes it easy to find, evaluate, and collaborate with verified experts.',
    link: { href: '/how-it-works#buyers', label: 'See how hiring works' },
  },
  {
    title: 'Technical Support',
    text: 'Experiencing technical issues or need help using our platform? Our support team is here to assist you.',
    email: true,
  },
];

const HOURS = [
  { day: 'Monday – Friday', time: '9:00 AM – 6:00 PM IST' },
  { day: 'Saturday', time: 'Closed' },
  { day: 'Sunday', time: 'Closed' },
];

export default function ContactPage() {
  return (
    <PageShell>
      <PageHero eyebrow="Get in Touch" title="Contact Us">
        We&apos;re here to help and answer any questions you might have about ASTEAI. Whether you&apos;re looking to
        hire deep-tech experts, offer your services, or just want to learn more about our platform, we&apos;d love to
        hear from you.
      </PageHero>

      <section className={page.block} aria-label="Ways to reach us">
        <div className={marketing.container}>
          <ul className={marketing.grid2}>
            {CHANNELS.map((c) => (
              <li key={c.title} className={marketing.card}>
                <h2 className={marketing.cardTitle}>{c.title}</h2>
                <p className={marketing.cardText}>{c.text}</p>
                {c.email && <p className={page.email}>{SUPPORT_EMAIL}</p>}
                {c.link && (
                  <p>
                    <Link href={c.link.href} className={marketing.textLink}>{c.link.label}</Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={page.block} aria-labelledby="form-title">
        <div className={`${marketing.container} ${page.contactGrid}`}>
          <form className={page.form} aria-labelledby="form-title" aria-describedby="form-note">
            <div>
              <h2 id="form-title" className={marketing.h2}>Send us a message</h2>
              <p className={marketing.cardText}>Fill out the form and we’ll get back within 24–48 hours.</p>
            </div>
            <p id="form-note" className={page.formNote}>
              Sending messages from this page isn’t available yet. Please email us at{' '}
              <span className={page.email}>{SUPPORT_EMAIL}</span> instead.
            </p>
            <div className={page.formRow}>
              <div className={page.field}>
                <label htmlFor="contact-name" className={page.label}>Name</label>
                <input id="contact-name" name="name" type="text" autoComplete="name" className={page.control} />
              </div>
              <div className={page.field}>
                <label htmlFor="contact-email" className={page.label}>Email</label>
                <input id="contact-email" name="email" type="email" autoComplete="email" className={page.control} />
              </div>
            </div>
            <div className={page.field}>
              <label htmlFor="contact-company" className={page.label}>
                Company <span className={page.optional}>(optional)</span>
              </label>
              <input
                id="contact-company"
                name="company"
                type="text"
                autoComplete="organization"
                className={page.control}
              />
            </div>
            <div className={page.field}>
              <label htmlFor="contact-message" className={page.label}>Message</label>
              <textarea
                id="contact-message"
                name="message"
                rows={5}
                maxLength={5000}
                placeholder="Tell us more about your inquiry..."
                className={page.control}
              />
            </div>
            <button
              type="submit"
              disabled
              aria-describedby="form-note"
              className={`${marketing.btn} ${marketing.btnPrimary} ${page.submit}`}
            >
              Send
            </button>
          </form>

          <aside className={page.aside} aria-label="Contact details">
            <div className={marketing.card}>
              <h2 className={marketing.cardTitle}>Business Hours</h2>
              <dl className={page.hours}>
                {HOURS.map((h) => (
                  <div key={h.day}>
                    <dt>{h.day}</dt>
                    <dd>{h.time}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className={marketing.card}>
              <h2 className={marketing.cardTitle}>Response Time</h2>
              <p className={marketing.cardText}>
                We typically respond to all inquiries within 24-48 hours during business days.
              </p>
            </div>
            <div className={marketing.card}>
              <h2 className={marketing.cardTitle}>Office Address</h2>
              <address className={page.address}>
                <strong>ASTEAI Platform</strong>
                <br />
                #1, 1st Main road, Aishwarya Nagar, Ayanambakkam, Chennai, TN, India - 600095
              </address>
            </div>
            <div className={marketing.card}>
              <h2 className={marketing.cardTitle}>Email Us</h2>
              <p className={page.email}>{SUPPORT_EMAIL}</p>
            </div>
          </aside>
        </div>
      </section>
    </PageShell>
  );
}
