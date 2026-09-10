// The theme is resolved once at startup and handed down through context; components read it
// with useTheme() and never detect anything themselves.
import { createContext, useContext, type ReactNode } from 'react';
import type { Theme } from './theme.js';

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme() needs a <ThemeProvider> above it (see src/tui/App.tsx).');
  return theme;
}
