import { useMemo, useState } from 'react';
import type { FsNode } from '../types';
import { formatBytes } from '../types';

type SortKey = 'name' | 'size' | 'type';

interface FileListProps {
  node: FsNode;
  onSelect: (path: string) => void;
}

export function FileList({ node, onSelect }: FileListProps): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('size');
  const [sortAsc, setSortAsc] = useState(false);

  const rows = useMemo(() => {
    const children = node.children || [];
    const sorted = [...children].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'size') cmp = a.size - b.size;
      else if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'type') {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        cmp = (a.ext || '').localeCompare(b.ext || '');
      }
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [node, sortKey, sortAsc]);

  function handleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'name');
    }
  }

  const total = node.size || 1;
  const arrow = (key: SortKey): string =>
    sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  if (rows.length === 0) {
    return (
      <div className="file-list empty">
        <div>This folder is empty.</div>
      </div>
    );
  }

  return (
    <div className="file-list">
      <table>
        <thead>
          <tr>
            <th onClick={() => handleSort('name')}>Name{arrow('name')}</th>
            <th onClick={() => handleSort('size')} className="num">
              Size{arrow('size')}
            </th>
            <th className="num">% of folder</th>
            <th onClick={() => handleSort('type')}>Type{arrow('type')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((child) => {
            const pct = (child.size / total) * 100;
            const isDir = child.type === 'dir';
            return (
              <tr
                key={child.path}
                onDoubleClick={() => isDir && onSelect(child.path)}
                className={isDir ? 'dir' : 'file'}
                title={isDir ? 'Double-click to enter' : child.path}
              >
                <td className="name">
                  <span className="label">{child.name}</span>
                  {child.error && (
                    <span className="error" title={child.error}>
                      {' '}⚠
                    </span>
                  )}
                </td>
                <td className="num">{formatBytes(child.size)}</td>
                <td className="num pct">
                  <div className="bar">
                    <div className="fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="pct-text">{pct.toFixed(1)}%</span>
                </td>
                <td className="type">
                  {isDir ? 'Folder' : child.ext || 'file'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
