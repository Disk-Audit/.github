import { useMemo, useState, useEffect } from 'react';
import type { MouseEvent } from 'react';
import type { FsNode } from '../types';
import { formatBytes } from '../types';

type SortKey = 'name' | 'size';

interface FileListProps {
  node: FsNode;
  onDrillIn: (path: string) => void;
}

interface ContextMenu {
  x: number;
  y: number;
  path: string;
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

export function FileList({ node, onDrillIn }: FileListProps): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('size');
  const [sortAsc, setSortAsc] = useState(false);
  const [menu, setMenu] = useState<ContextMenu | null>(null);

  // Close context menu on any global click/scroll/escape
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

  const children = useMemo(() => {
    return sortChildren(node.children || [], sortKey, sortAsc);
  }, [node, sortKey, sortAsc]);

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
    // Synthetic "small files" aggregate rows don't correspond to a real path,
    // so there's nothing for Explorer to open.
    if (path.endsWith('\\__small_files_bucket__')) return;
    setMenu({ x: e.clientX, y: e.clientY, path });
  }

  function handleOpenInExplorer(path: string): void {
    window.api.openInExplorer(path);
    setMenu(null);
  }

  const arrow = (key: SortKey): string =>
    sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  if (children.length === 0) {
    return (
      <div className="file-list">
        <div className="list-header">
          <span className="col-name">Name</span>
          <span className="col-size">Size</span>
          <span className="col-pct">%</span>
        </div>
        <div className="empty">This folder is empty.</div>
      </div>
    );
  }

  return (
    <div className="file-list">
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
      <div className="rows">
        {children.map((c, idx) => {
          const isDir = c.type === 'dir';
          const isBucket = c.path.endsWith('\\__small_files_bucket__');
          const pct = (c.size / total) * 100;
          const isTop = idx === 0;
          const iconName = isDir ? 'folder' : isBucket ? 'files' : 'file';
          return (
            <div
              key={c.path}
              className={`row${isDir ? ' clickable' : ''}${isTop ? ' selected' : ''}${isBucket ? ' bucket' : ''}`}
              onClick={() => {
                if (isDir) onDrillIn(c.path);
              }}
              onContextMenu={(e) => handleContextMenu(e, c.path)}
              title={isBucket ? `${c.name} — aggregated for performance` : c.path}
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

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => handleOpenInExplorer(menu.path)}>
            Open in Explorer
          </button>
        </div>
      )}
    </div>
  );
}
