/**
 * Light / dark theme. The choice lives in localStorage; with no stored choice the OS
 * preference wins. `THEME_INIT_SCRIPT` runs in <head> before first paint so there is no flash.
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'asteai-theme';

export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){}})();`;

export function readTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode): the theme still applies for this page view.
  }
}
