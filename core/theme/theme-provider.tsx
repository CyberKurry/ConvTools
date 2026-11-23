import { createContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface ThemeContextValue {
  readonly theme: ThemePreference;
  readonly resolved: 'light' | 'dark';
}

export const ThemeContext = createContext<ThemeContextValue>({ theme: 'system', resolved: 'light' });

export function ThemeProvider(props: { theme: ThemePreference; children: ReactNode }): ReactElement {
  // Track the OS scheme live so "match system" follows changes while open.
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  const resolved = props.theme === 'system' ? (systemDark ? 'dark' : 'light') : props.theme;
  const value = useMemo(() => ({ theme: props.theme, resolved }), [props.theme, resolved]);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

