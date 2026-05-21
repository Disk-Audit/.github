import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  DuplicateGroup,
  DuplicateScanProgress,
  DuplicateScanResult
} from '../types';
import { formatBytes } from '../types';

interface DuplicateFinderProps {
  folderPath: string;
  onClose: () => void;
  /** Called after at least one file was successfully trashed. The parent
   * uses this to re-scan; closing without deleting does NOT trigger it. */
  onAfterDelete?: () => void;
}

type Phase = 'scanning' | 'review' | 'deleting' | 'error';

interface DeletionStatus {
  succeeded: number;
  failed: number;
  errors: { path: string; message: string }[];
}

export function DuplicateFinder({
  folderPath,
  onClose,
  onAfterDelete
}: DuplicateFinderProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('scanning');
  const [progress, setProgress] = useState<DuplicateScanProgress>({
    phase: 'sizing',
    filesSeen: 0,
    candidatesHashed: 0,
    candidatesTotal: 0,
    currentPath: ''
  });
  const [result, setResult] = useState<DuplicateScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState<DeletionStatus | null>(null);

  useEffect(() => {
    const unsub = window.api.onDuplicateProgress((p) => setProgress(p));
    return unsub;
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.api
      .findDuplicates(folderPath)
      .then((r) => {
        if (cancelled) return;
        // Cancelled scans return a sentinel rather than the real result —
        // the component has already started unmounting in that case, but be
        // defensive and bail out anyway.
        if ('cancelled' in r) return;
        setResult(r);
        setPhase('review');
        const initial = new Set<string>();
        for (const g of r.groups) {
          for (let i = 1; i < g.files.length; i++) initial.add(g.files[i].path);
        }
        setSelected(initial);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      });
    return () => {
      cancelled = true;
      // Tell the main process to abort the walk/hash at its next checkpoint.
      // Without this the scan would keep running in the background, wasting
      // CPU and disk IO until it finished into the void.
      window.api.cancelDuplicateScan().catch(() => {
        /* ignore — the scan may have already finished naturally */
      });
    };
  }, [folderPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && phase !== 'deleting' && !confirming) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase, confirming]);

  const groups = result?.groups || [];

  // Selection guard: never let user select EVERY file in a group
  const safeSelected = useMemo<Set<string>>(() => {
    const safe = new Set<string>();
    for (const g of groups) {
      const inGroup = g.files.filter((f) => selected.has(f.path));
      if (inGroup.length < g.files.length) {
        for (const f of inGroup) safe.add(f.path);
      } else {
        // User tried to select everything — drop the newest from selection
        for (let i = 1; i < g.files.length; i++) safe.add(g.files[i].path);
      }
    }
    return safe;
  }, [groups, selected]);

  const toggleSelection = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectAllButNewest = useCallback((g: DuplicateGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      g.files.forEach((f, i) => {
        if (i === 0) next.delete(f.path);
        else next.add(f.path);
      });
      return next;
    });
  }, []);

  const selectAllButOldest = useCallback((g: DuplicateGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const lastIdx = g.files.length - 1;
      g.files.forEach((f, i) => {
        if (i === lastIdx) next.delete(f.path);
        else next.add(f.path);
      });
      return next;
    });
  }, []);

  const clearGroupSelection = useCallback((g: DuplicateGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const f of g.files) next.delete(f.path);
      return next;
    });
  }, []);

  const reclaimedBytes = useMemo(() => {
    let total = 0;
    for (const g of groups) {
      for (const f of g.files) {
        if (safeSelected.has(f.path)) total += f.size;
      }
    }
    return total;
  }, [groups, safeSelected]);

  const selectedCount = safeSelected.size;

  const handleConfirmDelete = useCallback(async () => {
    setConfirming(false);
    setPhase('deleting');
    const status: DeletionStatus = { succeeded: 0, failed: 0, errors: [] };
    for (const p of safeSelected) {
      try {
        await window.api.trashFile(p);
        status.succeeded++;
      } catch (e) {
        status.failed++;
        status.errors.push({
          path: p,
          message: e instanceof Error ? e.message : String(e)
        });
      }
    }
    setDeletionStatus(status);
    // Remove trashed files from displayed groups so the user can see progress
    setResult((prev) => {
      if (!prev) return prev;
      const trashed = new Set<string>();
      for (const p of safeSelected) {
        if (!status.errors.find((e) => e.path === p)) trashed.add(p);
      }
      const newGroups: DuplicateGroup[] = [];
      for (const g of prev.groups) {
        const remaining = g.files.filter((f) => !trashed.has(f.path));
        if (remaining.length >= 2) {
          newGroups.push({
            ...g,
            files: remaining,
            wastedBytes: g.size * (remaining.length - 1)
          });
        }
      }
      const totalWasted = newGroups.reduce((s, g) => s + g.wastedBytes, 0);
      return { ...prev, groups: newGroups, totalWasted };
    });
    setSelected(new Set());
    setPhase('review');
    if (status.succeeded > 0) {
      onAfterDelete?.();
    }
  }, [safeSelected, onAfterDelete]);

  // Don't dismiss on backdrop click while scanning or deleting — too easy
  // to bump into. The X button stays available, and closing via X cancels
  // the in-flight scan cleanly.
  const handleBackdropClick = (): void => {
    if (phase === 'scanning' || phase === 'deleting' || confirming) return;
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal dupe-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Find duplicate files</h2>
          <button
            className="modal-close"
            onClick={onClose}
            disabled={phase === 'deleting'}
            aria-label="Close"
          >
            <i className="ti ti-x" aria-hidden="true"></i>
          </button>
        </div>

        <div className="modal-subhead">
          <span className="dim">in</span>
          <code>{folderPath}</code>
        </div>

        {phase === 'scanning' && (
          <div className="dupe-scanning">
            <div className="dupe-scanning-label">
              {progress.phase === 'sizing'
                ? `Indexing files… ${progress.filesSeen.toLocaleString()} found`
                : progress.phase === 'hashing'
                  ? `Hashing candidates… ${progress.candidatesHashed.toLocaleString()} / ${progress.candidatesTotal.toLocaleString()}`
                  : 'Finalising…'}
            </div>
            <div className="indeterminate-bar">
              <div />
            </div>
            <div className="dupe-scanning-path" title={progress.currentPath}>
              {progress.currentPath || '\u00A0'}
            </div>
            <div className="dupe-note">
              Skipping <code>Windows</code>, <code>Program Files</code>,{' '}
              <code>ProgramData</code>, <code>$Recycle.Bin</code>,{' '}
              <code>/proc</code>, <code>/sys</code> and other system folders.
              Files under 64 KB are ignored.
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="dupe-error">
            <p>Scan failed:</p>
            <pre>{error}</pre>
          </div>
        )}

        {(phase === 'review' || phase === 'deleting') && result && (
          <>
            <div className="dupe-summary">
              <div className="dupe-summary-stat">
                <span className="dim">Files scanned</span>
                <span className="dupe-summary-value">
                  {result.filesScanned.toLocaleString()}
                </span>
              </div>
              <div className="dupe-summary-stat">
                <span className="dim">Duplicate groups</span>
                <span className="dupe-summary-value">
                  {groups.length.toLocaleString()}
                </span>
              </div>
              <div className="dupe-summary-stat">
                <span className="dim">Reclaimable</span>
                <span className="dupe-summary-value good">
                  {formatBytes(result.totalWasted)}
                </span>
              </div>
            </div>

            {deletionStatus && (
              <div className="dupe-status">
                <span className="good">
                  Trashed {deletionStatus.succeeded.toLocaleString()} file
                  {deletionStatus.succeeded === 1 ? '' : 's'}
                </span>
                {deletionStatus.failed > 0 && (
                  <span className="warn"> · {deletionStatus.failed} failed</span>
                )}
                <span className="dim">
                  {' '}
                  · sent to Recycle Bin
                </span>
                <button
                  className="dupe-status-link"
                  onClick={() => window.api.openTrash()}
                  title="Open the Recycle Bin to review or restore"
                >
                  <i className="ti ti-external-link" aria-hidden="true"></i>{' '}
                  Open Recycle Bin
                </button>
              </div>
            )}

            {groups.length === 0 ? (
              <div className="dupe-empty">
                <i className="ti ti-check empty-icon" aria-hidden="true"></i>
                <div className="dupe-empty-title">No duplicates here</div>
                <div className="dupe-empty-detail">
                  Scanned {result.filesScanned.toLocaleString()} file
                  {result.filesScanned === 1 ? '' : 's'} — none of them have
                  byte-identical copies in this folder.
                </div>
                <div className="dupe-empty-hint">
                  Files under 64 KB and system folders (Windows, /proc, etc.)
                  are skipped, so they wouldn't show up here either.
                </div>
              </div>
            ) : (
              <div className="dupe-groups">
                {groups.map((g) => (
                  <div className="dupe-group" key={g.hash}>
                    <div className="dupe-group-header">
                      <span className="dupe-group-size">
                        {formatBytes(g.size)}
                      </span>
                      <span className="dim"> × </span>
                      <span>{g.files.length} copies</span>
                      <span className="dim"> · reclaim </span>
                      <span className="good">{formatBytes(g.wastedBytes)}</span>
                      <span className="dupe-group-actions">
                        <button onClick={() => selectAllButNewest(g)}>
                          Keep newest
                        </button>
                        <button onClick={() => selectAllButOldest(g)}>
                          Keep oldest
                        </button>
                        <button onClick={() => clearGroupSelection(g)}>
                          Clear
                        </button>
                      </span>
                    </div>
                    <div className="dupe-group-files">
                      {g.files.map((f, idx) => {
                        const checked = safeSelected.has(f.path);
                        const wouldEmpty =
                          !checked &&
                          g.files.every(
                            (other) =>
                              other.path === f.path ||
                              safeSelected.has(other.path)
                          );
                        return (
                          <label
                            key={f.path}
                            className={`dupe-file${checked ? ' selected' : ''}${idx === 0 ? ' newest' : ''}${wouldEmpty ? ' locked' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={wouldEmpty}
                              onChange={() => toggleSelection(f.path)}
                            />
                            <span className="dupe-file-path" title={f.path}>
                              {f.path}
                            </span>
                            {idx === 0 && (
                              <span className="dupe-file-meta">newest</span>
                            )}
                            <span className="dupe-file-date">
                              {new Date(f.mtimeMs).toLocaleDateString()}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-footer">
              <div className="modal-footer-info">
                {selectedCount > 0 ? (
                  <>
                    <span className="good">{selectedCount}</span>
                    <span className="dim">
                      {' '}
                      file{selectedCount === 1 ? '' : 's'} selected ·{' '}
                    </span>
                    <span className="good">{formatBytes(reclaimedBytes)}</span>
                    <span className="dim"> to reclaim</span>
                  </>
                ) : (
                  <span className="dim">No files selected</span>
                )}
              </div>
              <button
                className="modal-cancel"
                onClick={onClose}
                disabled={phase === 'deleting'}
              >
                Close
              </button>
              <button
                className="modal-danger"
                disabled={
                  phase === 'deleting' ||
                  selectedCount === 0 ||
                  groups.length === 0
                }
                onClick={() => setConfirming(true)}
              >
                {phase === 'deleting'
                  ? 'Trashing…'
                  : `Send ${selectedCount} to Recycle Bin`}
              </button>
            </div>
          </>
        )}

        {confirming && (
          <div className="modal-backdrop confirm-backdrop">
            <div
              className="modal confirm-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <h3>Send {selectedCount} files to Recycle Bin?</h3>
              <p>
                This frees{' '}
                <span className="good">{formatBytes(reclaimedBytes)}</span>.
                Files are sent to the Recycle Bin — you can restore them from
                there if you change your mind.
              </p>
              <p className="dim small">
                System folders (Windows, Program Files, /proc, etc.) are never
                touched.
              </p>
              <div className="confirm-buttons">
                <button onClick={() => setConfirming(false)}>Cancel</button>
                <button
                  className="modal-danger"
                  onClick={handleConfirmDelete}
                  autoFocus
                >
                  Yes, send to Recycle Bin
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
