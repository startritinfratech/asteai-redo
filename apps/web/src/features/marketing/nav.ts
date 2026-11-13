/**
 * Public navigation: the three audience menus in the header (and mobile drawer), plus the
 * footer columns. Workspace links point into /platform, which sends signed-out visitors to
 * sign-in and back again.
 */
export interface MenuLink {
  href: string;
  label: string;
  desc: string;
}

export interface MenuGroup {
  heading: string;
  links: readonly MenuLink[];
}

export interface AudienceMenu {
  id: 'hire' | 'careers' | 'sourcing';
  label: string;
  /** Where the panel's "see the overview" link goes. */
  overview: { href: string; label: string };
  groups: readonly MenuGroup[];
}

export const AUDIENCE_MENUS: readonly AudienceMenu[] = [
  {
    id: 'hire',
    label: 'Hire & ATS',
    overview: { href: '/for-companies', label: 'ASTEAI for companies' },
    groups: [
      {
        heading: 'Plan & post',
        links: [
          { href: '/platform/requisitions', label: 'Requisitions', desc: 'Active roles, drafts and funding' },
          { href: '/platform/pipeline', label: 'Applications pipeline', desc: 'Stage-by-stage candidate review' },
          { href: '/platform/interviews', label: 'Interviews & offers', desc: 'AI interview summaries and scorecards' },
        ],
      },
      {
        heading: 'Source & engage',
        links: [
          { href: '/platform/pools', label: 'Talent CRM pools', desc: 'Kanban boards of sourced candidates' },
          { href: '/platform/outreach', label: 'Bulk outreach', desc: 'Email campaigns to your pools' },
          { href: '/pricing?audience=employer', label: 'Employer pricing', desc: 'Plans, credits and enterprise' },
        ],
      },
    ],
  },
  {
    id: 'careers',
    label: 'Careers & AI Prep',
    overview: { href: '/jobs', label: 'Browse open roles' },
    groups: [
      {
        heading: 'Find work',
        links: [
          { href: '/jobs', label: 'Open roles', desc: 'Live openings from verified employers' },
          { href: '/platform/applications', label: 'My applications', desc: 'Status and timeline of each application' },
          { href: '/for-experts', label: 'For candidates & experts', desc: 'How ASTEAI works for you' },
        ],
      },
      {
        heading: 'Prove your skills',
        links: [
          { href: '/platform/ai-interviews', label: 'AI interview studio', desc: 'Voice practice with a scored rubric' },
          { href: '/platform/assess', label: 'Role-fit assessments', desc: 'Server-scored, integrity reviewed' },
          { href: '/platform/passport', label: 'Talent Passport', desc: 'Verified results you can share' },
          { href: '/platform/certificates', label: 'Certificates', desc: 'Credentials anyone can verify' },
        ],
      },
    ],
  },
  {
    id: 'sourcing',
    label: 'Talent Sourcing',
    overview: { href: '/marketplace', label: 'Explore the marketplace' },
    groups: [
      {
        heading: 'Discover',
        links: [
          { href: '/experts', label: 'Find experts', desc: 'Vetted AI and deep-tech specialists' },
          { href: '/marketplace', label: 'Project marketplace', desc: 'Open engagements from enterprise teams' },
          { href: '/services', label: 'Pre-packaged services', desc: 'Fixed-scope deliverables' },
          { href: '/products', label: 'Digital products', desc: 'Models, tools and licences' },
        ],
      },
      {
        heading: 'Engage safely',
        links: [
          { href: '/platform/projects', label: 'Projects & milestones', desc: 'Proposals, milestones and SOWs' },
          { href: '/platform/contracts', label: 'Escrow contracts', desc: 'Agreements with milestone escrow' },
          { href: '/platform/wallet', label: 'Wallet & credits', desc: 'Balances, payouts and invoices' },
        ],
      },
    ],
  },
];

/** Plain links shown after the audience menus. */
export const TOP_LINKS = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
] as const;

export const FOOTER_COLUMNS = [
  {
    id: 'company',
    heading: 'Company',
    links: [
      { href: '/about', label: 'About us' },
      { href: '/contact', label: 'Contact us' },
      { href: '/careers', label: 'Careers' },
      { href: '/how-it-works', label: 'How it works' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    id: 'product',
    heading: 'Product',
    links: [
      { href: '/for-companies', label: 'For companies' },
      { href: '/for-experts', label: 'For candidates & experts' },
      { href: '/jobs', label: 'Open roles' },
      { href: '/experts', label: 'Find experts' },
      { href: '/services', label: 'Services' },
      { href: '/marketplace', label: 'Marketplace' },
    ],
  },
  {
    id: 'resources',
    heading: 'Resources',
    links: [
      { href: '/blog', label: 'Blog' },
      { href: '/case-studies', label: 'Case studies' },
      { href: '/#passport', label: 'Verify a certificate' },
      { href: '/contact', label: 'Help center' },
    ],
  },
] as const;
