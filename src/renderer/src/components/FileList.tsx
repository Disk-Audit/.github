import { useMemo, useState } from 'react';
import type { FsNode, Kind } from '../types';
import {
  formatBytes,
  kindFor,
  containsKind,
  countFiles,
  countDirs,
  shortenPath
} from '../types';

type SortKey = 'name' | 'size' | 'type';

interface FileListProps {
  node: FsNode;
  focusKind: Kind | null;
  onNavigate: (path: string) => void;
}

export function FileList({
  node,
  focusKind,
  onNavigate
}: FileListProps): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('size');
  const [sortAsc, setSortAsc] = useState(false);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const children = node.children || [];
    let arr = [...children];
    if (focusKind) {
      arr = arr.filter((c) => containsKind(c, focusKind));
    }
    if (query) {
      const q = query.toLowerCase();
      arr = arr.filter((c) => c.name.toLowerCase().includes(q));
    }
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'size') cmp = a.size - b.size;
      else if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'type') {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        cmp = (a.ext || '').localeCompare(b.ext || '');
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [node, sortKey, sortAsc, query, focusKind]);

  const total = node.size || 1;

  const handleSort = (k: SortKey): void => {
    if (sortKey === k) setSortAsc(!sortAsc);
    else {
      setSortKey(k);
      setSortAsc(k === 'name');
    }
  };

  const arrow = (k: SortKey): string =>
    sortKey === k ? (sortAsc ? '↑' : '↓') : '';

  const fileCount = countFiles(node);
  const dirCount = countDirs(node);

  return (
    <aside className="list-rail">
      <div className="list-head">
        <div className="where">CURRENT FOLDER</div>
        <h3 title={node.path}>{shortenPath(node.path)}</h3>
        <div className="summary">
          {formatBytes(node.size)} · {fileCount.toLocaleString()} files ·{' '}
          {dirCount.toLocaleString()} folders
        </div>
      </div>

      <div className="list-search">
        <input
          type="text"
          placeholder="Search this folder…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="list-cols">
        <div
          className={'col' + (sortKey === 'name' ? ' active' : '')}
          onClick={() => handleSort('name')}
        >
          Name {arrow('name')}
        </div>
        <div
          className={'col num' + (sortKey === 'size' ? ' active' : '')}
          onClick={() => handleSort('size')}
        >
          Size {arrow('size')}
        </div>
        <div className="col num">Share</div>
      </div>

      <div className="list-body">
        {rows.length === 0 && (
          <div className="list-empty">
            {query
              ? '— no matches —'
              : focusKind
                ? '— no files of that type —'
                : '— empty —'}
          </div>
        )}
        {rows.map((c) => {
          const pct = (c.size / total) * 100;
          const isDir = c.type === 'dir';
          const k = isDir ? 'other' : kindFor(c.ext);
          const swatch = `var(--k-${k})`;
          return (
            <div
              key={c.path}
              className={
                'row ' +
                (isDir ? 'dir' : 'file') +
                (c.error ? ' row-error' : '')
              }
              style={{ ['--swatch' as string]: swatch }}
              onClick={() => isDir && onNavigate(c.path)}
              onDoubleClick={() => isDir && onNavigate(c.path)}
              title={c.error ? `${c.path} · ${c.error}` : c.path}
            >
              <div className="name">
                {isDir ? <span className="chev">▸</span> : <span className="sw" />}
                <span className="name-label">{c.name}</span>
                {c.error && <span className="err" title={c.error}>⚠</span>}
              </div>
              <div className="size">{formatBytes(c.size)}</div>
              <div className="pctbar">
                <div className="bar">
                  <div
                    className="fill"
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
