import { useState, useEffect, useRef } from 'react';
import type { DriveInfo } from '../types';
import { formatBytes } from '../types';

interface DriveSwitcherProps {
  drives: DriveInfo[];
  currentPath: string;
  onPick: (path: string) => void;
  onChooseFolder: () => void;
}

function typeLabel(d: DriveInfo): string {
  if (d.driveType === 'network') return 'Network';
  if (d.driveType === 'removable') return 'Removable';
  if (d.mediaType === 'ssd') return 'SSD';
  if (d.mediaType === 'hdd') return 'HDD';
  return 'Local disk';
}

function badgeIcon(d: DriveInfo): string {
  // Tabler icon class used INSIDE the badge for non-letter drives. Network
  // drives keep their mapped letter visible but get a small subscript icon
  // via CSS — the renderer uses the letter as the visible glyph either way.
  if (d.driveType === 'network') return 'ti-server';
  return '';
}

/* ----- UNC validation + normalization ---------------------------------- */

const UNC_RE = /^\\\\[^\\/?*:|"<>]+\\[^\\/?*:|"<>]+(\\.*)?$/;

function isUncPath(p: string): boolean {
  if (!p.startsWith('\\\\')) return false;
  return UNC_RE.test(p);
}

function normalizeUnc(p: string): string {
  // Trim whitespace; collapse forward-slashes to backslashes; drop trailing
  // backslash for storage in recents (we'll add it back when scanning).
  let s = p.trim().replace(/\//g, '\\');
  while (s.endsWith('\\')) s = s.slice(0, -1);
  return s;
}

/* ----- Recents (localStorage) ----------------------------------------- */

const RECENTS_KEY = 'ledgeon-network-recents';
const RECENTS_LIMIT = 6;

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string' && isUncPath(s));
  } catch {
    return [];
  }
}

function saveRecent(unc: string): string[] {
  const norm = normalizeUnc(unc);
  if (!isUncPath(norm)) return loadRecents();
  const current = loadRecents().filter((s) => s.toLowerCase() !== norm.toLowerCase());
  const next = [norm, ...current].slice(0, RECENTS_LIMIT);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
  return next;
}

function dropRecent(unc: string): string[] {
  const current = loadRecents().filter(
    (s) => s.toLowerCase() !== unc.toLowerCase()
  );
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  return current;
}

/**
 * For a scanned-path like `C:\Users\foo` or `\\server\share\sub`, find which
 * drive in `drives` owns it. Match by drive letter on Windows, UNC prefix
 * for network paths, longest mount-path prefix on Linux.
 */
function findCurrentDrive(
  drives: DriveInfo[],
  currentPath: string
): DriveInfo | null {
  if (!currentPath) return null;
  // UNC paths — match against drives whose path is also a UNC prefix
  if (currentPath.startsWith('\\\\')) {
    const lower = currentPath.toLowerCase();
    const matches = drives.filter((d) => {
      const dp = (d.path || '').toLowerCase();
      const rp = (d.remotePath || '').toLowerCase();
      const candidates = [dp, rp].filter(Boolean);
      return candidates.some(
        (c) => lower === c || lower.startsWith(c.endsWith('\\') ? c : c + '\\')
      );
    });
    return matches.sort((a, b) => (b.path?.length || 0) - (a.path?.length || 0))[0] || null;
  }
  if (/^[A-Za-z]:/.test(currentPath)) {
    const letter = currentPath.charAt(0).toUpperCase();
    return (
      drives.find((d) => d.letter.charAt(0).toUpperCase() === letter) || null
    );
  }
  const candidates = drives
    .filter(
      (d) => d.path && (currentPath === d.path || currentPath.startsWith(d.path + '/'))
    )
    .sort((a, b) => b.path.length - a.path.length);
  return candidates[0] || null;
}

export function DriveSwitcher({
  drives,
  currentPath,
  onPick,
  onChooseFolder
}: DriveSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'drives' | 'network'>('drives');
  const [uncInput, setUncInput] = useState('');
  const [uncError, setUncError] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset to drive list whenever the dropdown closes
  useEffect(() => {
    if (!open) {
      setView('drives');
      setUncInput('');
      setUncError(null);
    }
  }, [open]);

  // Autofocus the UNC input when switching to the network view
  useEffect(() => {
    if (open && view === 'network') {
      // Defer to next frame so the input is mounted
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open, view]);

  // Click outside / Escape closes the dropdown (Escape in UNC input mode
  // goes back to the drive list first)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (view === 'network') {
        setView('drives');
      } else {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, view]);

  const current = findCurrentDrive(drives, currentPath);

  const handleScanUnc = (raw: string): void => {
    const norm = normalizeUnc(raw);
    if (!isUncPath(norm)) {
      setUncError('Enter a path like \\\\server\\share');
      return;
    }
    setRecents(saveRecent(norm));
    setOpen(false);
    // Append a trailing backslash so the walker treats it as a directory root
    onPick(norm + '\\');
  };

  return (
    <div className="drive-switcher" ref={rootRef}>
      <button
        className="drive-switcher-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch drive"
      >
        {current ? (
          <>
            <span className="drive-switcher-letter">{current.letter}</span>
            <span className="drive-switcher-label">
              {current.label || typeLabel(current)}
            </span>
          </>
        ) : (
          <span className="drive-switcher-label dim">Drives</span>
        )}
        <i className="ti ti-chevron-down chevron" aria-hidden="true"></i>
      </button>

      {open && view === 'drives' && (
        <div className="drive-switcher-menu" role="listbox">
          <div className="drive-switcher-menu-header">Detected drives</div>
          {drives.length === 0 && (
            <div className="drive-switcher-empty">No drives detected.</div>
          )}
          {drives.map((d) => {
            const total = d.totalBytes;
            const free = d.freeBytes;
            const used = Math.max(0, total - free);
            const pct = total > 0 ? (used / total) * 100 : 0;
            const isCurrent = current?.path === d.path;
            const isNet = d.driveType === 'network';
            return (
              <button
                key={d.path || d.letter}
                role="option"
                aria-selected={isCurrent}
                className={`drive-switcher-item${isCurrent ? ' current' : ''}${isNet ? ' network' : ''}`}
                onClick={() => {
                  setOpen(false);
                  onPick(d.path);
                }}
                title={isNet && d.remotePath ? d.remotePath : undefined}
              >
                <span className="drive-switcher-item-badge">
                  {isNet && badgeIcon(d) ? (
                    <i className={`ti ${badgeIcon(d)}`} aria-hidden="true"></i>
                  ) : (
                    d.letter
                  )}
                </span>
                <div className="drive-switcher-item-body">
                  <div className="drive-switcher-item-row1">
                    <span className="drive-switcher-item-name">
                      {d.label || (isNet && d.remotePath) || typeLabel(d)}
                    </span>
                    <span className="drive-switcher-item-type">
                      {typeLabel(d)}
                      {d.fileSystem ? ` · ${d.fileSystem}` : ''}
                    </span>
                  </div>
                  <div className="drive-switcher-item-row2">
                    {isNet && d.remotePath && (!d.label || d.label !== d.remotePath) ? (
                      <span className="drive-switcher-item-unc" title={d.remotePath}>
                        {d.remotePath}
                      </span>
                    ) : total > 0 ? (
                      <>
                        <span>
                          <span className="dim">Used </span>
                          {formatBytes(used)}
                          <span className="dim"> / {formatBytes(total)}</span>
                        </span>
                        <span
                          className={`drive-switcher-item-pct${pct >= 90 ? ' warn' : ''}`}
                        >
                          {pct.toFixed(0)}%
                        </span>
                      </>
                    ) : (
                      <span className="dim">size unavailable</span>
                    )}
                  </div>
                  {total > 0 && !isNet && (
                    <div className="drive-switcher-item-bar">
                      <span
                        className={`drive-switcher-item-bar-fill${pct >= 90 ? ' warn' : ''}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          <div className="drive-switcher-divider"></div>
          <button
            className="drive-switcher-folder-btn"
            onClick={() => {
              setOpen(false);
              onChooseFolder();
            }}
          >
            <i className="ti ti-folder" aria-hidden="true"></i>
            Choose folder…
          </button>
          <button
            className="drive-switcher-folder-btn"
            onClick={() => setView('network')}
          >
            <i className="ti ti-server" aria-hidden="true"></i>
            Network location…
          </button>
        </div>
      )}

      {open && view === 'network' && (
        <div className="drive-switcher-menu drive-switcher-menu-network" role="dialog">
          <div className="drive-switcher-menu-header">
            <button
              className="drive-switcher-back"
              onClick={() => setView('drives')}
              aria-label="Back"
              title="Back to drives"
            >
              <i className="ti ti-arrow-left" aria-hidden="true"></i>
            </button>
            <span>Network location</span>
          </div>

          <div className="drive-switcher-unc-form">
            <input
              ref={inputRef}
              type="text"
              className={`drive-switcher-unc-input${uncError ? ' invalid' : ''}`}
              placeholder="\\server\share"
              value={uncInput}
              onChange={(e) => {
                setUncInput(e.target.value);
                if (uncError) setUncError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleScanUnc(uncInput);
                }
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button
              className="drive-switcher-unc-submit"
              onClick={() => handleScanUnc(uncInput)}
              disabled={!uncInput.trim()}
            >
              Scan
            </button>
          </div>
          {uncError && <div className="drive-switcher-unc-error">{uncError}</div>}
          <div className="drive-switcher-unc-hint">
            Examples:{' '}
            <code>\\fileserver\public</code>{' '}
            <code>\\nas01\media\photos</code>
          </div>

          {recents.length > 0 && (
            <>
              <div className="drive-switcher-divider"></div>
              <div className="drive-switcher-menu-header">Recent</div>
              {recents.map((unc) => (
                <div key={unc} className="drive-switcher-recent">
                  <button
                    className="drive-switcher-recent-main"
                    onClick={() => handleScanUnc(unc)}
                    title={unc}
                  >
                    <i className="ti ti-server" aria-hidden="true"></i>
                    <span className="drive-switcher-recent-path">{unc}</span>
                  </button>
                  <button
                    className="drive-switcher-recent-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRecents(dropRecent(unc));
                    }}
                    title="Remove from recents"
                    aria-label="Remove from recents"
                  >
                    <i className="ti ti-x" aria-hidden="true"></i>
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
