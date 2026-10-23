/**
 * @file useUpdateCheck.ts
 * @description React hook for managing update checking logic.
 */

import { useState, useCallback } from 'react';
import { compareVersions } from '../utils/versionUtils';
import packageJson from '../../package.json';

export interface GitHubReleaseResponse {
  tag_name: string;
  html_url: string;
  published_at: string;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isGitHubReleaseResponse(value: unknown): value is GitHubReleaseResponse {
  if (!isObjectRecord(value)) return false;

  return (
    typeof value.tag_name === 'string' &&
    typeof value.html_url === 'string' &&
    typeof value.published_at === 'string'
  );
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseDate: string;
}

export interface UpdateCheckState {
  checking: boolean;
  result: UpdateCheckResult | null;
  error: string | null;
}

/**
 * Hook for checking for app updates via GitHub API
 */
export function useUpdateCheck() {
  const [state, setState] = useState<UpdateCheckState>({
    checking: false,
    result: null,
    error: null,
  });

  /**
   * Check for updates by querying GitHub API
   */
  const checkForUpdates = useCallback(async () => {
    setState({ checking: true, result: null, error: null });

    try {
      const currentVersion = packageJson.version;

      // Fetch latest release from GitHub
      const response = await fetch(
        'https://api.github.com/repos/Hart365/pp-md-pptb-edition/releases/latest',
        {
          headers: {
            'Accept': 'application/vnd.github+json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const releasePayload: unknown = await response.json();
      if (!isGitHubReleaseResponse(releasePayload)) {
        throw new Error('GitHub response shape is invalid.');
      }

      const release = releasePayload;
      const latestVersion = release.tag_name;

      // Compare versions
      const versionComparison = compareVersions(currentVersion, latestVersion);

      if (versionComparison >= 0) {
        // Already on latest or newer version
        setState({
          checking: false,
          result: {
            hasUpdate: false,
            currentVersion,
            latestVersion,
            releaseUrl: release.html_url,
            releaseDate: release.published_at,
          },
          error: null,
        });
        return;
      }

      setState({
        checking: false,
        result: {
          hasUpdate: true,
          currentVersion,
          latestVersion,
          releaseUrl: release.html_url,
          releaseDate: release.published_at,
        },
        error: null,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setState({
        checking: false,
        result: null,
        error: errorMessage,
      });
    }
  }, []);

  /**
   * Clear the update check result
   */
  const dismiss = useCallback(() => {
    setState({ checking: false, result: null, error: null });
  }, []);

  return {
    ...state,
    checkForUpdates,
    dismiss,
  };
}
