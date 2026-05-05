/**
 * @file vite-env.d.ts
 * @description Vite client type declarations — exposes import.meta.env and
 * other Vite-specific globals to TypeScript.
 */

/// <reference types="vite/client" />
/// <reference types="@pptb/types" />

/**
 * Extend the global window object with app-specific properties.
 */
interface Window {
  __PPMD_VERSION__?: string;
  electron?: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
}
