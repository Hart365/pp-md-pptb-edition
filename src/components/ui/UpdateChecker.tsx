/**
 * @file UpdateChecker.tsx
 * @description Component for checking and displaying app updates.
 * WCAG: 2.1.2 (focus trap), 2.4.3 (focus order/return), 4.1.3 (status messages).
 */

import { useEffect, useRef, useState, useId } from 'react';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { formatFileSize } from '../../utils/versionUtils';
import styles from './UpdateChecker.module.css';

/**
 * UpdateChecker component with button and modal for displaying updates
 */
export function UpdateChecker() {
  const [showDialog, setShowDialog] = useState(false);
  const { checking, result, error, checkForUpdates, dismiss } = useUpdateCheck();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const handleCheck = async () => {
    setShowDialog(true);
    await checkForUpdates();
  };

  const handleDismiss = () => {
    dismiss();
    setShowDialog(false);
    triggerRef.current?.focus();
  };

  // Move focus into the dialog on open and trap Tab within it (WCAG 2.1.2, 2.4.3).
  useEffect(() => {
    if (!showDialog) return;
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;

    const focusables = () => Array.from(
      dialogEl.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'),
    );
    focusables()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleDismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialogEl.addEventListener('keydown', handleKeyDown);
    return () => dialogEl.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDialog]);

  const handleDownload = () => {
    if (result?.downloadAsset?.downloadUrl) {
      window.open(result.downloadAsset.downloadUrl, '_blank');
    } else if (result?.releaseUrl) {
      window.open(result.releaseUrl, '_blank');
    }
  };

  return (
    <>
      {/* Update Check Button */}
      <button
        ref={triggerRef}
        className={styles.updateButton}
        onClick={handleCheck}
        disabled={checking}
        title="Check for available updates"
        aria-label="Check for updates"
      >
        {checking ? '⟳ Checking...' : '⟳ Updates'}
      </button>

      {/* Update Dialog */}
      {showDialog && (
        <div className={styles.dialogOverlay} onClick={handleDismiss}>
          <dialog
            ref={dialogRef}
            className={styles.dialog}
            onClick={e => e.stopPropagation()}
            aria-modal="true"
            aria-labelledby={titleId}
            open
          >
            <div className={styles.dialogContent}>
              <h2 className={styles.dialogTitle} id={titleId}>Check for Updates</h2>

              {checking && (
                <div className={styles.loading} role="status" aria-live="polite">
                  <div className={styles.spinner} aria-hidden="true"></div>
                  <p>Checking for updates...</p>
                </div>
              )}

              {error && (
                <div className={styles.error} role="alert">
                  <p className={styles.errorTitle}>Error checking for updates</p>
                  <p className={styles.errorMessage}>{error}</p>
                </div>
              )}

              {result && !checking && (
                <div className={styles.result}>
                  <div className={styles.versionInfo}>
                    <p>
                      <strong>Current version:</strong> {result.currentVersion}
                    </p>
                    <p>
                      <strong>Latest version:</strong> {result.latestVersion}
                    </p>
                    {result.releaseDate && (
                      <p>
                        <strong>Released:</strong>{' '}
                        {new Date(result.releaseDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>

                  {result.hasUpdate ? (
                    <div className={styles.updateAvailable}>
                      <div className={styles.updateBanner}>
                        ✓ A new version is available!
                      </div>
                      {result.downloadAsset && (
                        <div className={styles.downloadInfo}>
                          <p>
                            <strong>File:</strong> {result.downloadAsset.name}
                          </p>
                          <p>
                            <strong>Size:</strong>{' '}
                            {formatFileSize(result.downloadAsset.size)}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={styles.noUpdate}>
                      <p>✓ You are already using the latest version!</p>
                    </div>
                  )}
                </div>
              )}

              {/* Dialog Buttons */}
              <div className={styles.dialogButtons}>
                {result && result.hasUpdate && result.downloadAsset && (
                  <button
                    className={`${styles.button} ${styles.downloadButton}`}
                    onClick={handleDownload}
                  >
                    Download Update
                  </button>
                )}
                {result && !result.hasUpdate && (
                  <button
                    className={`${styles.button} ${styles.primaryButton}`}
                    onClick={handleDismiss}
                  >
                    OK
                  </button>
                )}
                {error && (
                  <button
                    className={`${styles.button} ${styles.primaryButton}`}
                    onClick={handleDismiss}
                  >
                    Close
                  </button>
                )}
                {!result && !error && (
                  <button
                    className={`${styles.button} ${styles.secondaryButton}`}
                    onClick={handleDismiss}
                    disabled={checking}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </dialog>
        </div>
      )}
    </>
  );
}
