/**
 * @file DataverseSolutionBrowser.tsx
 * @description Solution browser for Dataverse-connected mode.
 */

import type { DataverseSolutionSummary } from '../../dataverse/solutionService';
import styles from './DataverseSolutionBrowser.module.css';

export interface DataverseSolutionBrowserProps {
  solutions: DataverseSolutionSummary[];
  publisherOptions: string[];
  selectedPublishers: string[];
  selectedSolutionIds: string[];
  search: string;
  sort: 'name-asc' | 'name-desc' | 'version-asc' | 'version-desc';
  managedFilter: 'all' | 'managed' | 'unmanaged';
  isLoading: boolean;
  error: string;
  busySolutionIds?: string[];
  onSearchChange: (value: string) => void;
  onSortChange: (value: 'name-asc' | 'name-desc' | 'version-asc' | 'version-desc') => void;
  onManagedFilterChange: (value: 'all' | 'managed' | 'unmanaged') => void;
  onTogglePublisher: (publisher: string) => void;
  onSelectAllPublishers: () => void;
  onClearPublishers: () => void;
  onToggleSolution: (solutionId: string) => void;
  onSelectAllVisibleSolutions: () => void;
  onClearSelectedSolutions: () => void;
  onRefresh: () => void;
}

export function DataverseSolutionBrowser({
  solutions,
  publisherOptions,
  selectedPublishers,
  selectedSolutionIds,
  search,
  sort,
  managedFilter,
  isLoading,
  error,
  busySolutionIds = [],
  onSearchChange,
  onSortChange,
  onManagedFilterChange,
  onTogglePublisher,
  onSelectAllPublishers,
  onClearPublishers,
  onToggleSolution,
  onSelectAllVisibleSolutions,
  onClearSelectedSolutions,
  onRefresh,
}: DataverseSolutionBrowserProps) {
  const selectedSet = new Set(selectedSolutionIds);
  const busySet = new Set(busySolutionIds);

  return (
    <section className={styles.browser} aria-labelledby="dataverse-solutions-heading">
      <div className={styles.headerRow}>
        <div>
          <h2 id="dataverse-solutions-heading" className={styles.heading}>Connected Dataverse Solutions</h2>
          <p className={styles.subtitle}>
            Read solution metadata directly from the active environment without exporting or uploading solution files.
          </p>
        </div>
        <button type="button" className={styles.refreshBtn} onClick={onRefresh} disabled={isLoading}>
          Refresh
        </button>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search by display name or unique name"
          />
        </label>

        <label className={styles.field}>
          <span>Sort</span>
          <select value={sort} onChange={(event) => onSortChange(event.target.value as DataverseSolutionBrowserProps['sort'])}>
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="version-desc">Version High-Low</option>
            <option value="version-asc">Version Low-High</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Managed</span>
          <select value={managedFilter} onChange={(event) => onManagedFilterChange(event.target.value as DataverseSolutionBrowserProps['managedFilter'])}>
            <option value="all">All</option>
            <option value="managed">Managed only</option>
            <option value="unmanaged">Unmanaged only</option>
          </select>
        </label>
      </div>

      <details className={styles.publisherFilter}>
        <summary className={styles.publisherSummary}>Filter by Publisher ({selectedPublishers.length} selected)</summary>
        <div className={styles.publisherActions}>
          <button type="button" className={styles.miniBtn} onClick={onSelectAllPublishers}>Select all</button>
          <button type="button" className={styles.miniBtn} onClick={onClearPublishers}>Clear</button>
        </div>
        <div className={styles.publisherList} role="group" aria-label="Publisher filters">
          {publisherOptions.map((publisher) => {
            const checked = selectedPublishers.includes(publisher);
            return (
              <label key={publisher} className={styles.publisherItem}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onTogglePublisher(publisher)}
                />
                <span>{publisher}</span>
              </label>
            );
          })}
        </div>
      </details>

      <div className={styles.selectionBar}>
        <span className={styles.selectionText}>{selectedSolutionIds.length} selected</span>
        <div className={styles.selectionActions}>
          <button type="button" className={styles.miniBtn} onClick={onSelectAllVisibleSolutions}>
            Select visible
          </button>
          <button type="button" className={styles.miniBtn} onClick={onClearSelectedSolutions}>
            Clear selection
          </button>
        </div>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {isLoading ? (
        <div className={styles.loading} role="status" aria-live="polite">Loading solutions...</div>
      ) : solutions.length === 0 ? (
        <p className={styles.empty}>No matching solutions were found for the selected filters.</p>
      ) : (
        <div className={styles.list} role="list">
          {solutions.map((solution) => {
            const isSelected = selectedSet.has(solution.solutionId);
            const isBusy = busySet.has(solution.solutionId);
            return (
              <article key={solution.solutionId} className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`} role="listitem">
                <label className={styles.cardCheckbox}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSolution(solution.solutionId)}
                    disabled={isBusy}
                    aria-label={`Select ${solution.displayName}`}
                  />
                  <div className={styles.cardMeta}>
                    <div className={styles.cardTopLine}>
                      <h3 className={styles.cardTitle} title={`${solution.displayName} (${solution.uniqueName})`}>
                        {solution.displayName}
                      </h3>
                      <div className={styles.badges}>
                        <span className={styles.badge}>v{solution.version || 'n/a'}</span>
                        <span className={styles.badge}>{solution.isManaged ? 'Managed' : 'Unmanaged'}</span>
                      </div>
                    </div>
                    <p className={styles.cardDescription}>
                      {solution.description?.trim() || solution.publisherName || 'No description available.'}
                    </p>
                  </div>
                </label>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
