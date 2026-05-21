import { useMemo, useState, useEffect } from 'react';
import type { MouseEvent } from 'react';
import type { FsNode } from '../types';
import { formatBytes } from '../types';

type SortKey = 'name' | 'size';

interface FileListProps {
  node: FsNode;
  onDrillIn: (path: string) => void;
  /** Called when a file was successfully trashed. Parent removes it from
   * the tree client-side — no re-scan needed. */
  onFileTrashed?: (path: string) => void;
}

interface ContextMenu {
  x: number;
  y: number;
  path: string;
  isBucket: boolean;
  isProtected: boolean;
}

// Mirror of the main-process FORBIDDEN_SEGMENTS list. The IPC layer also
// refuses to trash these, but checking here lets us hide the menu option
// entirely so the user never sees an action they can't perform.
const FORBIDDEN_SEGMENTS = new Set([
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'system volume information',
  '$recycle.bin',
  '$winreagent',
  '$windows.~bt',
  '$windows.~ws',
  'proc',
  'sys',
  'dev',
  'run',
  'snap'
]);

function isPathProtected(p: string): boolean {
  // Refuse to trash a drive root outright — empty body inside the slash check.
  if (/^[A-Za-z]:[\\/]?$/.test(p)) return true;
  if (p === '/' || p === '') return true;
  const parts = p.split(/[\\/]/);
  for (const part of parts) {
    if (FORBIDDEN_SEGMENTS.has(part.toLowerCase())) return true;
  }
  return false;
}

function sortChildren(
  children: FsNode[],
  sortKey: SortKey,
  sortAsc: boolean
): FsNode[] {
  return [...children].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'size') cmp = a.size - b.size;
    else cmp = a.name.localeCompare(b.name);
    return sortAsc ? cmp : -cmp;
  });
}

export function FileList({
  node,
  onDrillIn,
  onFileTrashed
}: FileListProps): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('size');
  const [sortAsc, setSortAsc] = useState(false);
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Reset search when navigating to a different folder
  useEffect(() => {
    setQuery('');
  }, [node.path]);

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const filtered = useMemo(() => {
    const all = sortChildren(node.children || [], sortKey, sortAsc);
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter((c) => c.name.toLowerCase().includes(q));
  }, [node, sortKey, sortAsc, query]);

  const total = node.size || 1;

  function handleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'name');
    }
  }

  function handleContextMenu(e: MouseEvent, path: string): void {
    e.preventDefault();
    const isBucket = path.endsWith('\\__small_files_bucket__');
    const isProtected = isPathProtected(path);
    setMenu({ x: e.clientX, y: e.clientY, path, isBucket, isProtected });
  }

  function handleOpenInExplorer(path: string): void {
    window.api.openInExplorer(path);
    setMenu(null);
  }

  function handleRequestDelete(path: string): void {
    setMenu(null);
    setConfirmDelete(path);
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await window.api.trashFile(target);
      onFileTrashed?.(target);
    } catch (e) {
      alert(
        `Could not send to Recycle Bin: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const arrow = (key: SortKey): string =>
    sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  const hasChildren = (node.children || []).length > 0;

  return (
    <div className="file-list">
      {hasChildren && (
        <div className="file-list-search">
          <i className="ti ti-search" aria-hidden="true"></i>
          <input
            type="text"
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="file-list-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear filter"
            >
              <i className="ti ti-x" aria-hidden="true"></i>
            </button>
          )}
        </div>
      )}

      <div className="list-header">
        <button
          className="header-sortable col-name"
          onClick={() => handleSort('name')}
        >
          Name{arrow('name')}
        </button>
        <button
          className="header-sortable col-size"
          onClick={() => handleSort('size')}
        >
          Size{arrow('size')}
        </button>
        <span className="col-pct">%</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          {!hasChildren
            ? 'This folder is empty.'
            : `No files matching "${query}"`}
        </div>
      ) : (
        <div className="rows">
          {filtered.map((c, idx) => {
            const isDir = c.type === 'dir';
            const isBucket = c.path.endsWith('\\__small_files_bucket__');
            const pct = (c.size / total) * 100;
            const isTop = idx === 0 && !query;
            const iconName = isDir ? 'folder' : isBucket ? 'files' : 'file';
            return (
              <div
                key={c.path}
                className={`row${isDir ? ' clickable' : ''}${isTop ? ' selected' : ''}${isBucket ? ' bucket' : ''}`}
                onClick={() => {
                  if (isDir) onDrillIn(c.path);
                }}
                onContextMenu={(e) => handleContextMenu(e, c.path)}
                title={
                  isBucket ? `${c.name} — aggregated for performance` : c.path
                }
              >
                <i className={`ti ti-${iconName} icon`} aria-hidden="true"></i>
                <span className="name-text">{c.name}</span>
                {c.error && (
                  <span className="error-icon" title={c.error}>
                    <i className="ti ti-alert-triangle" aria-hidden="true"></i>
                  </span>
                )}
                <span className="col-size">{formatBytes(c.size)}</span>
                <span className="col-pct">{pct.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      )}

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!menu.isBucket && (
            <>
              <button onClick={() => handleOpenInExplorer(menu.path)}>
                Open in Explorer
              </button>
              {!menu.isProtected && (
                <button
                  className="ctx-danger"
                  onClick={() => handleRequestDelete(menu.path)}
                >
                  Send to Recycle Bin
                </button>
              )}
              {menu.isProtected && (
                <div
                  className="ctx-disabled"
                  title="Protected system folder — deletion is not allowed"
                >
                  Protected — can't delete
                </div>
              )}
            </>
          )}
          {menu.isBucket && (
            <div className="ctx-disabled">No actions for this group</div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div
            className="modal confirm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Send to Recycle Bin?</h3>
            <p>
              <code className="confirm-path">{confirmDelete}</code>
            </p>
            <p className="dim small">
              The item is sent to the Recycle Bin — you can restore it from
              there if you change your mind.
            </p>
            <div className="confirm-buttons">
              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="modal-danger" onClick={handleConfirmDelete}>
                Send to Recycle Bin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
