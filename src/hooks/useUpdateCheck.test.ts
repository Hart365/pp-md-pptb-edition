import { describe, expect, it } from 'vitest';
import {
  isAppInfoResponse,
  isGitHubReleaseResponse,
  mapReleaseAssets,
  type AppInfoResponse,
  type GitHubReleaseResponse,
} from './useUpdateCheck';

describe('useUpdateCheck helpers', () => {
  it('validates app info payload shape correctly', () => {
    const valid: AppInfoResponse = {
      platform: 'windows',
      architecture: 'x64',
      installType: 'portable',
    };

    expect(isAppInfoResponse(valid)).toBe(true);
    expect(isAppInfoResponse({ platform: 'ios' })).toBe(false);
  });

  it('validates GitHub release payload shape correctly', () => {
    const valid: GitHubReleaseResponse = {
      tag_name: '1.2.3',
      html_url: 'https://github.com/org/repo/releases/tag/1.2.3',
      published_at: '2026-05-03T00:00:00.000Z',
      assets: [],
    };

    expect(isGitHubReleaseResponse(valid)).toBe(true);
    expect(isGitHubReleaseResponse({ tag_name: '1.2.3' })).toBe(false);
  });

  it('maps and filters release assets safely', () => {
    const release: GitHubReleaseResponse = {
      tag_name: '1.2.3',
      html_url: 'https://example.invalid',
      published_at: '2026-05-03T00:00:00.000Z',
      assets: [
        {
          name: 'tool-x64.zip',
          browser_download_url: 'https://example.invalid/tool-x64.zip',
          size: 123,
        },
        {
          // intentionally invalid object to verify guard filtering
          name: 'broken.zip',
          browser_download_url: 'https://example.invalid/broken.zip',
          size: Number.NaN,
        } as unknown as { name: string; browser_download_url: string; size: number },
      ],
    };

    const assets = mapReleaseAssets(release);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toEqual({
      name: 'tool-x64.zip',
      downloadUrl: 'https://example.invalid/tool-x64.zip',
      size: 123,
    });
  });
});
