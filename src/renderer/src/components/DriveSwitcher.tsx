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
  if (d.driveType === 'removable') return 'Removable';
  if (d.mediaType === 'ssd') return 'SSD';
  if (d.mediaType === 'hdd') return 'HDD';
  return 'Local disk';
}

/**
 * For a scanned-path like `C:\Users\foo`, find which drive in `drives` owns
 * it. Same logic the App uses for its capacity label — match by drive letter
 * on Windows, longest mount-path prefix on Linux.
 */
function findCurrentDrive(
  drives: DriveInfo[],
  currentPath: string
): DriveInfo | null {
  if (!currentPath) return null;
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
  const rootRef = useRef<HTMLDivElement>(null);

  // Click outside / Escape closes the dropdown
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = findCurrentDrive(drives, currentPath);

  return (
    <div className="drive-switcher" ref={rootRef}>
      <button
        className="drive-switcher-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch drive"
      >
        <i className="ti ti-device-desktop" aria-hidden="true"></i>
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

      {open && (
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
            return (
              <button
                key={d.path || d.letter}
                role="option"
                aria-selected={isCurrent}
                className={`drive-switcher-item${isCurrent ? ' current' : ''}`}
                onClick={() => {
                  setOpen(false);
                  onPick(d.path);
                }}
              >
                <span className="drive-switcher-item-badge">{d.letter}</span>
                <div className="drive-switcher-item-body">
                  <div className="drive-switcher-item-row1">
                    <span className="drive-switcher-item-name">
                      {d.label || typeLabel(d)}
                    </span>
                    <span className="drive-switcher-item-type">
                      {typeLabel(d)}
                      {d.fileSystem ? ` · ${d.fileSystem}` : ''}
                    </span>
                  </div>
                  <div className="drive-switcher-item-row2">
                    {total > 0 ? (
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
                  {total > 0 && (
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
        </div>
      )}
    </div>
  );
}
