/**
 * @file DropZone.tsx
 * @description Accessible drag-and-drop / click-to-browse file input component.
 */

import { useRef, useState, useCallback, useEffect, type DragEvent, type ChangeEvent } from 'react';
import styles from './DropZone.module.css';

export interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  onQueueChange?: (files: File[]) => void;
  showGenerateButton?: boolean;
  resetToken?: number;
}

function isValidZip(file: File): boolean {
  return (
    file.type === 'application/zip'
    || file.type === 'application/x-zip-compressed'
    || file.name.toLowerCase().endsWith('.zip')
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function sortFilesByName(files: File[]): File[] {
  return [...files].sort((left, right) => left.name.localeCompare(
    right.name,
    undefined,
    { numeric: true, sensitivity: 'base' },
  ));
}

export function DropZone({
  onFilesSelected,
  disabled = false,
  onQueueChange,
  showGenerateButton = true,
  resetToken,
}: DropZoneProps) {
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onQueueChange?.(queuedFiles);
  }, [queuedFiles, onQueueChange]);

  useEffect(() => {
    setQueuedFiles([]);
    setError('');
  }, [resetToken]);

  const handleFiles = useCallback((rawFiles: File[]) => {
    const valid = rawFiles.filter(isValidZip);
    const invalid = rawFiles.filter((file) => !isValidZip(file));

    if (invalid.length > 0) {
      setError(`${invalid.length} file(s) ignored - only .zip files are accepted.`);
    } else {
      setError('');
    }

    if (valid.length === 0) return;

    setQueuedFiles((prev) => {
      const merged = [...prev];
      valid.forEach((file) => {
        if (!merged.some((item) => item.name.toLowerCase() === file.name.toLowerCase())) {
          merged.push(file);
        }
      });
      return sortFilesByName(merged);
    });
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled) setIsDragActive(true);
  }, [disabled]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    if (disabled) return;
    handleFiles(Array.from(event.dataTransfer.files));
  }, [disabled, handleFiles]);

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    handleFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  }, [handleFiles]);

  const handleZoneKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && !disabled) {
      event.preventDefault();
      inputRef.current?.click();
    }
  }, [disabled]);

  const removeFile = useCallback((name: string) => {
    setQueuedFiles((prev) => prev.filter((file) => file.name !== name));
  }, []);

  const handleProcess = useCallback(() => {
    if (queuedFiles.length === 0 || disabled) return;
    onFilesSelected(sortFilesByName(queuedFiles));
    setQueuedFiles([]);
  }, [disabled, onFilesSelected, queuedFiles]);

  const zoneClass = [
    styles.dropzone,
    isDragActive ? styles.active : '',
    disabled ? styles.disabled : '',
  ].filter(Boolean).join(' ');

  return (
    <div>
      <div
        className={zoneClass}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Drop zone: drag and drop Power Platform solution ZIP files here, or press Enter to browse"
        aria-disabled={disabled}
        aria-describedby="dz-subtitle"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onKeyDown={handleZoneKeyDown}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <div aria-live="polite" className="sr-only">
          {isDragActive ? 'Drop files to add them' : ''}
        </div>

        <div className={styles.icon} aria-hidden="true">
          {isDragActive ? '📂' : '📁'}
        </div>

        <p className={styles.title}>
          {isDragActive ? 'Release to add files' : 'Drag & drop solution ZIP files here'}
        </p>
        <p id="dz-subtitle" className={styles.subtitle}>
          Accepts one or more Power Platform solution ZIP archives. You can also click or press Enter to browse.
        </p>

        <button
          type="button"
          className={styles.browseBtn}
          disabled={disabled}
          aria-label="Browse for solution ZIP files"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            inputRef.current?.click();
          }}
        >
          Browse files
        </button>

        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          multiple
          disabled={disabled}
          aria-hidden="true"
          tabIndex={-1}
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />
      </div>

      {error && (
        <p
          role="alert"
          aria-live="assertive"
          style={{
            marginTop: '0.5rem',
            color: 'var(--color-error)',
            fontSize: '0.875rem',
          }}
        >
          {error}
        </p>
      )}

      {queuedFiles.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
            {queuedFiles.length} file{queuedFiles.length > 1 ? 's' : ''} ready to process:
          </p>
          <ul className={styles.fileList} aria-label="Files queued for processing">
            {queuedFiles.map((file) => (
              <li key={file.name} className={styles.fileItem}>
                <span className={styles.fileIcon} aria-hidden="true">🗜️</span>
                <span className={styles.fileName} title={file.name}>{file.name}</span>
                <span
                  style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}
                  aria-label={`Size: ${humanSize(file.size)}`}
                >
                  {humanSize(file.size)}
                </span>
                <button
                  type="button"
                  className={styles.removeBtn}
                  aria-label={`Remove ${file.name} from the queue`}
                  onClick={() => removeFile(file.name)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {showGenerateButton && (
            <button
              type="button"
              onClick={handleProcess}
              disabled={disabled}
              style={{
                marginTop: '1rem',
                padding: '0.6rem 1.5rem',
                background: 'var(--color-accent)',
                color: 'var(--color-text-inverse)',
                border: 'none',
                borderRadius: 'var(--border-radius-md)',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                transition: 'background var(--transition-fast)',
              }}
              aria-label={`Generate documentation for ${queuedFiles.length} file${queuedFiles.length > 1 ? 's' : ''}`}
            >
              Generate Documentation
            </button>
          )}
        </div>
      )}
    </div>
  );
}
