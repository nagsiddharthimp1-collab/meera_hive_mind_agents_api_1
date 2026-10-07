'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Default to light theme
  const [theme, updateTheme] = useState<Theme>('light');

  useEffect(() => {
    let savedTheme: Theme = 'light';
    try { if (localStorage.getItem('theme') === 'dark') savedTheme = 'dark'; } catch { /* Use the default. */ }
    updateTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', savedTheme === 'dark' ? '#262624' : '#faf3e9');
  }, []);

  const setTheme = useCallback((next: Theme) => {
    updateTheme(next);
    try { localStorage.setItem('theme', next); } catch { /* Theme changes still work. */ }
    document.documentElement.setAttribute('data-theme', next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#262624' : '#faf3e9');
  }, []);
  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  // Keep the provider mounted from the first render so restoring a theme cannot remount the chat.
  return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
