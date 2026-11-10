/* A full public profile. Hook-free, so both the server page and the owner preview render it. */
import { AVAILABILITY_LABEL, ENGAGEMENT_LABEL, money, STATUS_LABEL } from './format';
import { Avatar, PassportBadge, Stars } from './ExpertDirectory';
import { ExpertActions } from './ExpertActions';
import type { ExpertDetail } from './types';
import styles from './profiles.module.css';

const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short' });

export function ExpertProfileView({ expert }: { expert: ExpertDetail }) {
  const rates = [
    expert.hourlyRate !== null && `${money(expert.hourlyRate, expert.currency)} / hour`,
    expert.dailyRate !== null && `${money(expert.dailyRate, expert.currency)} / day`,
    expert.fixedFrom !== null && `Fixed projects from ${money(expert.fixedFrom, expert.currency)}`,
  ].filter(Boolean) as string[];
  const links = [
    ['Portfolio', expert.portfolioUrl], ['LinkedIn', expert.linkedinUrl], ['GitHub', expert.githubUrl],
  ].filter(([, url]) => url);

  return (
    <div className={styles.profile}>
      <div className={styles.stack}>
        {expert.status !== 'approved' && (
          <p className={styles.notice} role="status">
            Preview — this profile is <b>{STATUS_LABEL[expert.status].toLowerCase()}</b> and not visible to the public.
          </p>
        )}
        <section className={styles.panel} aria-labelledby="about-h">
          <div className={styles.cardTop}>
            <Avatar name={expert.name} url={expert.avatarUrl} />
            <div className={styles.stack} style={{ gap: 6 }}>
              <h2 id="about-h" className={styles.cardName}>About {expert.name}</h2>
              <div className={styles.row}>
                {expert.passport && <PassportBadge tier={expert.passport.tier} />}
                <Stars rating={expert.rating} count={expert.reviewCount} />
              </div>
            </div>
          </div>
          {expert.summary && <p className={styles.summary} style={{ marginTop: 14 }}>{expert.summary}</p>}
        </section>

        {(expert.skills.length > 0 || expert.domains.length > 0) && (
          <section className={styles.panel} aria-labelledby="skills-h">
            <h2 id="skills-h">Expertise</h2>
            <div className={styles.stack} style={{ gap: 10 }}>
              {expert.skills.length > 0 && (
                <ul className={styles.skills} aria-label="Skills">
                  {expert.skills.map((s) => <li key={s} className={styles.skill}>{s}</li>)}
                </ul>
              )}
              {expert.domains.length > 0 && (
                <p className={styles.muted}>Domains: {expert.domains.join(' · ')}</p>
              )}
            </div>
          </section>
        )}

        <section className={styles.panel} aria-labelledby="reviews-h">
          <h2 id="reviews-h">Reviews</h2>
          {expert.reviews.length === 0 ? (
            <p className={styles.muted}>No reviews yet.</p>
          ) : (
            <ul className={styles.reviews}>
              {expert.reviews.map((r) => (
                <li key={r.id} className={styles.review}>
                  <div className={styles.row}>
                    <span className={styles.stars} aria-label={`${r.rating} out of 5`}>{'★'.repeat(r.rating)}</span>
                    <b>{r.reviewerName}</b>
                    <span className={styles.muted}>{r.projectTitle ? `${r.projectTitle} · ` : ''}{date(r.createdAt)}</span>
                  </div>
                  {r.comment && <p>{r.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className={styles.stack}>
        <section className={styles.panel} aria-label="Work with this expert">
          <ExpertActions expertId={expert.userId} expertName={expert.name} />
        </section>
        <section className={styles.panel} aria-labelledby="facts-h">
          <h2 id="facts-h">At a glance</h2>
          <dl className={styles.facts}>
            <dt>Rates</dt><dd>{rates.length ? rates.join(', ') : 'On request'}</dd>
            {expert.engagementModes.length > 0 && (
              <><dt>Works</dt><dd>{expert.engagementModes.map((m) => ENGAGEMENT_LABEL[m]).join(', ')}</dd></>
            )}
            <dt>Availability</dt><dd>{AVAILABILITY_LABEL[expert.availability]}</dd>
            {expert.yearsExperience !== null && <><dt>Experience</dt><dd>{expert.yearsExperience} years</dd></>}
            {expert.location && <><dt>Location</dt><dd>{expert.location}</dd></>}
            {expert.languages.length > 0 && <><dt>Languages</dt><dd>{expert.languages.join(', ')}</dd></>}
            {expert.memberSince && <><dt>Member since</dt><dd>{date(expert.memberSince)}</dd></>}
          </dl>
        </section>
        {links.length > 0 && (
          <section className={styles.panel} aria-labelledby="links-h">
            <h2 id="links-h">Links</h2>
            <ul className={styles.links}>
              {links.map(([label, url]) => (
                <li key={label}><a href={url} target="_blank" rel="noopener noreferrer nofollow ugc">{label}</a></li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
