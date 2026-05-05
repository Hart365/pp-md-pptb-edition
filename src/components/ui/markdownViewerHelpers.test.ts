import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { extractText, slugifyHeading } from './MarkdownViewer';

describe('markdownViewer heading helpers', () => {
  it('extractText reads simple string and number nodes', () => {
    expect(extractText('Hello')).toBe('Hello');
    expect(extractText(42)).toBe('42');
  });

  it('extractText flattens arrays of nodes', () => {
    expect(extractText(['Power', ' ', 'Platform'])).toBe('Power   Platform');
  });

  it('extractText traverses prop children shape', () => {
    const mockNode = { props: { children: ['Alpha', 'Beta'] } };
    expect(extractText(mockNode as unknown as ReactNode)).toBe('Alpha Beta');
  });

  it('slugifyHeading normalizes casing, punctuation, and whitespace', () => {
    expect(slugifyHeading('Power Platform: Solution #1')).toBe('power-platform-solution-1');
  });

  it('slugifyHeading falls back to section for empty content', () => {
    expect(slugifyHeading('   ')).toBe('section');
  });
});
