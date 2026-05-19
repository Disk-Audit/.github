import { useMemo, useState, useCallback } from 'react';
import type { FsNode } from '../types';
import { formatBytes } from '../types';

type SortKey = 'name' | 'size' | 'type';

interface FileListProps {
  node: FsNode;
  onSelect: (path: string) => void;
}

function sortChildren(
  children: FsNode[],
  sortKey: SortKey,
  sortAsc: boolean
): FsNode[] {
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
}

interface RowProps {
  child: FsNode;
  total: number;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  sortKey: SortKey;
  sortAsc: boolean;
}

function Row({
  child,
  total,
  depth,
  expanded,
  onToggle,
  onSelect,
  sortKey,
  sortAsc
}: RowProps): JSX.Element {
  const isDir = child.type === 'dir';
  const isOpen = expanded.has(child.path);
  const pct = total > 0 ? (child.size / total) * 100 : 0;

  // Sort and slice children when expanded; cap at 200 to stay snappy on huge dirs
  const visibleChildren = useMemo(() => {
    if (!isOpen || !child.children) return null;
    return sortChildren(child.children, sortKey, sortAsc).slice(0, 200);
  }, [isOpen, child.children, sortKey, sortAsc]);

  const truncatedCount =
    isOpen && child.children && child.children.length > 200
      ? child.children.length - 200
      : 0;

  return (
    <>
      <tr
        className={isDir ? 'dir' : 'file'}
        onClick={() => {
          if (isDir) onToggle(child.path);
        }}
        title={isDir ? 'Click to expand, double-click to drill in' : child.path}
        onDoubleClick={() => {
          if (isDir) onSelect(child.path);
        }}
      >
        <td className="name">
          <span className="indent" style={{ paddingLeft: depth * 16 }}>
            <span className={`twirl ${isDir ? '' : 'leaf'} ${isOpen ? 'open' : ''}`}>
              {isDir ? '▸' : '·'}
            </span>
            <span className="label">{child.name}</span>
            {child.error && (
              <span className="error" title={child.error}>
                {' '}⚠
              </span>
            )}
          </span>
        </td>
        <td className="num">{formatBytes(child.size)}</td>
        <td className="num pct">
          <div className="bar">
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="pct-text">{pct.toFixed(1)}%</span>
        </td>
        <td className="type">{isDir ? 'Folder' : child.ext || 'file'}</td>
      </tr>
      {visibleChildren?.map((grandchild) => (
        <Row
          key={grandchild.path}
          child={grandchild}
          total={child.size || 1}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          sortKey={sortKey}
          sortAsc={sortAsc}
        />
      ))}
      {truncatedCount > 0 && (
        <tr className="truncated">
          <td colSpan={4}>
            <span style={{ paddingLeft: (depth + 1) * 16 + 20 }}>
              … {truncatedCount.toLocaleString()} more items hidden. Double-click
              the folder to drill in.
            </span>
          </td>
        </tr>
      )}
    </>
  );
}

export function FileList({ node, onSelect }: FileListProps): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('size');
  const [sortAsc, setSortAsc] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Reset expansion when we navigate to a new folder
  const nodePath = node.path;
  useMemo(() => {
    setExpanded(new Set());
  }, [nodePath]);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const rows = useMemo(() => {
    return sortChildren(node.children || [], sortKey, sortAsc);
  }, [node, sortKey, sortAsc]);

  function handleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'name');
    }
  }

  const arrow = (key: SortKey): string =>
    sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  if (rows.length === 0) {
    return (
      <div className="file-list empty">
        <div>This folder is empty.</div>
      </div>
    );
  }

  const total = node.size || 1;

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
          {rows.map((child) => (
            <Row
              key={child.path}
              child={child}
              total={total}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              onSelect={onSelect}
              sortKey={sortKey}
              sortAsc={sortAsc}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
