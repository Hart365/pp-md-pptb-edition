import { describe, expect, it } from 'vitest';
import {
  isGitHubReleaseResponse,
  type GitHubReleaseResponse,
} from './useUpdateCheck';

describe('useUpdateCheck helpers', () => {
  it('validates GitHub release payload shape correctly', () => {
    const valid: GitHubReleaseResponse = {
      tag_name: '1.2.3',
      html_url: 'https://github.com/org/repo/releases/tag/1.2.3',
      published_at: '2026-05-03T00:00:00.000Z',
    };

    expect(isGitHubReleaseResponse(valid)).toBe(true);
    expect(isGitHubReleaseResponse({ tag_name: '1.2.3' })).toBe(false);
  });
});
