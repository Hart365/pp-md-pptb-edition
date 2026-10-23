/**
 * @file toolboxAPI.ts
 * @description Wrapper for Power Platform ToolBox APIs.
 * Provides type-safe access to toolboxAPI and dataverseAPI available in the iframe context.
 */

/// <reference types="@pptb/types" />

/**
 * Check if we're running in PPTB environment
 */
export function isInPPTB(): boolean {
  return typeof window !== 'undefined' && 'toolboxAPI' in window;
}

const SETTINGS_KEY_PREFIX = 'pp-md-pptb-edition-';
const eventSubscribers = new Set<
  (_event: string, payload: { event: string; data: unknown }) => void
>();
let eventBridgeHost: ToolBoxAPI.EventsAPI | null = null;

function namespaceSettingKey(key: string): string {
  return key.startsWith(SETTINGS_KEY_PREFIX) ? key : `${SETTINGS_KEY_PREFIX}${key}`;
}

function dispatchToolboxEvent(event: unknown, payload: ToolBoxAPI.ToolBoxEventPayload): void {
  for (const callback of eventSubscribers) {
    callback(String(event), payload);
  }
}

/**
 * Show a notification in the PPTB interface
 */
export async function showNotification(
  title: string,
  body: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'info',
  duration: number = 3000
): Promise<void> {
  if (isInPPTB()) {
    return window.toolboxAPI.utils.showNotification({
      title,
      body,
      type,
      duration,
    });
  }
}

/**
 * Get the active Dataverse connection
 */
export async function getActiveConnection(): Promise<IConnection | null> {
  if (isInPPTB()) {
    return window.toolboxAPI.connections.getActiveConnection();
  }
  return null;
}

/**
 * Subscribe to PPTB events
 */
export function onToolboxEvent(
  callback: (_event: string, payload: { event: string; data: unknown }) => void
): (() => void) | undefined {
  if (!isInPPTB()) return undefined;

  const hostEvents = window.toolboxAPI.events;
  if (!eventBridgeHost) {
    eventBridgeHost = hostEvents;
    eventBridgeHost.on(dispatchToolboxEvent);
  }
  eventSubscribers.add(callback);

  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    eventSubscribers.delete(callback);

    if (eventSubscribers.size === 0 && eventBridgeHost) {
      eventBridgeHost.off(dispatchToolboxEvent);
      eventBridgeHost = null;
    }
  };
}

/**
 * Get tool-specific settings
 */
export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const namespacedKey = namespaceSettingKey(key);
  if (isInPPTB()) {
    const value = await window.toolboxAPI.settings.get(namespacedKey);
    return value === undefined ? null : value as T;
  }

  if (import.meta.env.DEV && typeof localStorage !== 'undefined') {
    try {
      const value = localStorage.getItem(namespacedKey);
      return value === null ? null : JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Save tool-specific settings
 */
export async function saveSetting(key: string, value: unknown): Promise<void> {
  const namespacedKey = namespaceSettingKey(key);
  if (isInPPTB()) {
    return window.toolboxAPI.settings.set(namespacedKey, value);
  }

  if (import.meta.env.DEV && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(namespacedKey, JSON.stringify(value));
    } catch {
      // Best-effort local development persistence.
    }
  }
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (isInPPTB()) {
    return window.toolboxAPI.utils.copyToClipboard(text);
  } else {
    // Fallback for development
    return navigator.clipboard.writeText(text);
  }
}

/**
 * Resolve the current ToolBox theme when running inside PPTB.
 */
export async function getCurrentTheme(): Promise<'light' | 'dark'> {
  if (isInPPTB()) {
    return window.toolboxAPI.utils.getCurrentTheme();
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Open a URL in the user's external/system browser.
 * Inside PPTB the renderer runs in a restricted webview where `target="_blank"`
 * anchor clicks are silently swallowed, so links must be routed through the
 * host's `openInConnectionBrowser` bridge. Returns false when not in PPTB so
 * callers can fall back to normal anchor navigation.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (!isInPPTB()) return false;
  try {
    await window.toolboxAPI.utils.openInConnectionBrowser(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Trigger a file download
 */
export async function downloadFile(
  content: string | Blob,
  filename: string,
  mimeType: string = 'text/plain'
): Promise<void> {
  if (isInPPTB()) {
    // Use filesystem save dialog in PPTB when direct utility download is unavailable.
    if (content instanceof Blob) {
      const arrayBuffer = await content.arrayBuffer();
      await window.toolboxAPI.fileSystem.saveFile(filename, new Uint8Array(arrayBuffer));
      return;
    }

    await window.toolboxAPI.fileSystem.saveFile(filename, content);
    return;
  } else {
    // Fallback to browser download
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

/**
 * Query Dataverse using FetchXML
 */
export async function queryDataverse(
  fetchXml: string,
  includeFormattedValues: boolean = false,
  includeAnnotations: boolean = false,
  pageNumber: number = 1
): Promise<unknown> {
  if (isInPPTB()) {
    void includeFormattedValues;
    void includeAnnotations;
    void pageNumber;
    return window.dataverseAPI.fetchXmlQuery(fetchXml);
  }
  return null;
}

/**
 * Retrieve a record from Dataverse
 */
export async function retrieveRecord(
  tableName: string,
  recordId: string,
  columns?: string[]
): Promise<unknown> {
  if (isInPPTB()) {
    return window.dataverseAPI.retrieve(tableName, recordId, columns);
  }
  return null;
}

/**
 * Interface for Dataverse connection
 */
export interface IConnection extends ToolBoxAPI.DataverseConnection {
  environmentId?: string;
  instanceUrl?: string;
  orgId?: string;
  userId?: string;
}
