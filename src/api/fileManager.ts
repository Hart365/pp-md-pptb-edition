/**
 * @file fileManager.ts
 * @description Handles file operations for the tool, including exports and downloads.
 * Uses PPTB APIs when available, with fallbacks for development.
 */

import { downloadFile } from './toolboxAPI';

/**
 * Export markdown content as a file
 */
export async function exportMarkdown(content: string, filename: string): Promise<void> {
  // Ensure filename ends with .md
  const safeName = filename.endsWith('.md') ? filename : `${filename}.md`;
  
  // Use PPTB API or fallback to browser download
  await downloadFile(content, safeName, 'text/markdown');
}

/**
 * Export ZIP file content
 */
export async function exportZip(blob: Blob, filename: string): Promise<void> {
  // Ensure filename ends with .zip
  const safeName = filename.endsWith('.zip') ? filename : `${filename}.zip`;
  
  await downloadFile(blob, safeName, 'application/zip');
}

/**
 * Export JSON content
 */
export async function exportJson(data: unknown, filename: string): Promise<void> {
  // Ensure filename ends with .json
  const safeName = filename.endsWith('.json') ? filename : `${filename}.json`;
  
  const content = JSON.stringify(data, null, 2);
  await downloadFile(content, safeName, 'application/json');
}

/**
 * Generate a safe filename from a display name
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^\w\s.-]/g, '') // Remove special characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .slice(0, 200); // Limit length
}

/**
 * Create a blob from text content
 */
export function createTextBlob(content: string, mimeType: string = 'text/plain'): Blob {
  return new Blob([content], { type: mimeType });
}

/**
 * Create a filename with timestamp
 */
export function createTimestampedFilename(baseName: string, extension: string = ''): string {
  const now = new Date();
  const timestamp = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return `${baseName}_${timestamp}${extension}`;
}
