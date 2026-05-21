import { useMemo } from 'react';
import type { FsNode, ExtensionBreakdown } from '../types';
import { formatBytes } from '../types';

interface FileTypePanelProps {
  node: FsNode;
  onSelectExt?: (ext: string) => void;
}

/**
 * Walk the tree (deep) and aggregate file sizes by extension. The Rust walker's
 * "(N small files)" buckets are tagged with an `ext` of `_small` so they don't
 * pollute the real extension counts — we skip those here.
 */
function buildBreakdown(node: FsNode): ExtensionBreakdown[] {
  const map = new Map<string, { size: number; count: number }>();

  function visit(n: FsNode): void {
    if (n.type === 'file') {
      // Skip synthetic small-file buckets — they aggregate many extensions
      const isBucket = /^\(\d+ small files?\)$/.test(n.name);
      if (isBucket) return;
      const ext = n.ext || extractExt(n.name) || '(no ext)';
      const e = map.get(ext);
      if (e) {
        e.size += n.size;
        e.count += 1;
      } else {
        map.set(ext, { size: n.size, count: 1 });
      }
      return;
    }
    if (n.children) for (const c of n.children) visit(c);
  }
  visit(node);

  return [...map.entries()]
    .map(([ext, v]) => ({ ext, size: v.size, count: v.count }))
    .sort((a, b) => b.size - a.size);
}

function extractExt(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot).toLowerCase();
}

export function FileTypePanel({
  node,
  onSelectExt
}: FileTypePanelProps): JSX.Element {
  const rows = useMemo(() => buildBreakdown(node), [node]);
  const total = useMemo(() => rows.reduce((s, r) => s + r.size, 0), [rows]);
  const top = rows.slice(0, 40);

  if (rows.length === 0) {
    return (
      <div className="filetype-empty">
        <div>No files in this folder.</div>
      </div>
    );
  }

  return (
    <div className="filetype-panel">
      <div className="filetype-header">
        <span className="col-ext">EXT</span>
        <span className="col-size">SIZE</span>
        <span className="col-bar"></span>
        <span className="col-count">FILES</span>
      </div>
      <div className="filetype-rows">
        {top.map((r) => {
          const pct = total > 0 ? (r.size / total) * 100 : 0;
          return (
            <button
              key={r.ext}
              className="filetype-row"
              onClick={() => onSelectExt?.(r.ext)}
              title={`${r.ext} — ${formatBytes(r.size)} across ${r.count.toLocaleString()} files`}
            >
              <span className="col-ext">{r.ext}</span>
              <span className="col-size">{formatBytes(r.size)}</span>
              <span className="col-bar">
                <span
                  className="filetype-bar-fill"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </span>
              <span className="col-count">{r.count.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
