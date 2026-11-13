/**
 * Only same-site paths from notifications are followed (the API stores '#' for
 * anything else). Rejects protocol-relative and backslash tricks such as '//evil.com'
 * and '/\evil.com' (browsers treat '\' like '/'), and anything that resolves to
 * another origin.
 */
export function isInternalLink(link: string | null | undefined, origin: string): boolean {
  if (!link || typeof link !== 'string') return false;
  if (!link.startsWith('/') || /^\/[\\/]/.test(link)) return false;
  // Control characters (tabs/newlines are stripped by URL parsers) could hide a scheme.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(link)) return false;
  try {
    return new URL(link, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
