/**
 * @file ThemeContext.tsx
 * @description React context for managing light/dark theme across the app.
 * Reads the user's OS preference via the `prefers-color-scheme` media query
 * and persists the choice to localStorage.  Applies the chosen theme as a
 * `data-theme` attribute on <html> so that CSS custom properties can switch
 * all colours in one place.
 *
 * WCAG 2.2 compliance notes:
 *  - 1.4.3 Contrast (Minimum): all colour tokens defined in global.css meet
 *    or exceed the 4.5:1 ratio for normal text and 3:1 for large text.
 *  - 1.4.11 Non-text Contrast: interactive component borders use tokens that
 *    meet 3:1 against their backgrounds.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { getCurrentTheme, isInPPTB, onToolboxEvent } from '../api/toolboxAPI';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The two supported colour schemes. */
export type Theme = 'light' | 'dark';

/** Shape of the context value exposed to consumers. */
export interface ThemeContextValue {
  /** Currently active theme. */
  theme: Theme;
  /**
   * Toggle between light and dark.
   * Safe to call from ARIA button handlers.
   */
  toggleTheme: () => void;
  /** Explicitly set the theme. */
  setTheme: (theme: Theme) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Resolves the initial theme from the host environment or OS setting.
 *
 * @returns The resolved {@link Theme}
 */
function getInitialTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Applies the theme to the document root and updates the browser chrome
 * `theme-color` meta tag so that device taskbars / address bars reflect
 * the current colour mode.
 *
 * @param theme - The new theme to apply
 */
function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  // Update <meta name="theme-color"> to match the background token
  const themeColor = theme === 'dark' ? '#1e1e2e' : '#f8f9fa';
  const metaTag = document.querySelector('meta[name="theme-color"]');
  if (metaTag) metaTag.setAttribute('content', themeColor);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * ThemeProvider wraps the application and makes the theme context available
 * to all descendant components.
 *
 * @param children - React tree to render inside the provider
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  // Apply theme to DOM on every change.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Sync with PPTB host theme when running inside ToolBox.
  useEffect(() => {
    let disposed = false;

    const syncTheme = async () => {
      const nextTheme = await getCurrentTheme();
      if (!disposed) {
        setThemeState(nextTheme);
      }
    };

    if (isInPPTB()) {
      void syncTheme();

      const unsubscribe = onToolboxEvent((_event, payload) => {
        if (payload.event === 'settings:updated') {
          void syncTheme();
        }
      });

      return () => {
        disposed = true;
        unsubscribe?.();
      };
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setThemeState(e.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      disposed = true;
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    if (isInPPTB()) return;
    setThemeState(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    if (isInPPTB()) return;
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Custom hook for consuming the theme context.
 * Must be used inside a {@link ThemeProvider}.
 *
 * @returns The current {@link ThemeContextValue}
 * @throws If used outside a ThemeProvider
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
