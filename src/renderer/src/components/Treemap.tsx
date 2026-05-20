import { useMemo, useState, useRef, useEffect } from 'react';
import { hierarchy, treemap } from 'd3-hierarchy';
import type { FsNode } from '../types';
import { formatBytes } from '../types';

// Top 4 children get the semantic palette ramps; everything else falls back
// to neutral so the eye lands on what actually matters.
const PALETTE = [
  { bg: 'var(--color-background-info)', fg: 'var(--color-text-info)' },
  { bg: 'var(--color-background-warning)', fg: 'var(--color-text-warning)' },
  { bg: 'var(--color-background-success)', fg: 'var(--color-text-success)' },
  { bg: 'var(--color-background-danger)', fg: 'var(--color-text-danger)' }
];
const NEUTRAL = {
  bg: 'var(--color-background-secondary)',
  fg: 'var(--color-text-secondary)'
};

interface TreemapProps {
  node: FsNode;
  onDrillIn: (path: string) => void;
}

interface Hover {
  node: FsNode;
  x: number;
  y: number;
}

interface LaidRect {
  node: FsNode;
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
}

export function Treemap({ node, onDrillIn }: TreemapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hover, setHover] = useState<Hover | null>(null);

  // Re-lay on container resize so the treemap stays squarified.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const rects = useMemo<LaidRect[] | null>(() => {
    if (!node.children || node.children.length === 0) return null;

    // Sort children desc by size so we can assign palette tiers by rank.
    const sortedChildren = [...node.children].sort((a, b) => b.size - a.size);
    const rankMap = new Map<string, number>();
    sortedChildren.forEach((c, i) => rankMap.set(c.path, i));

    // Build a depth-1 hierarchy: the immediate children become leaves so the
    // treemap shows only this level (drill in to see deeper levels).
    const flatRoot: FsNode = {
      ...node,
      children: node.children.map((c) => ({ ...c, children: undefined }))
    };

    const h = hierarchy<FsNode>(flatRoot, (d) => d.children)
      .sum((d) =>
        d.children && d.children.length > 0 ? 0 : Math.max(d.size, 0)
      )
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    treemap<FsNode>()
      .size([size.width, size.height])
      .paddingOuter(0)
      .paddingInner(2)
      .round(true)(h);

    return h
      .leaves()
      .filter((l) => {
        const w = (l.x1 ?? 0) - (l.x0 ?? 0);
        const hh = (l.y1 ?? 0) - (l.y0 ?? 0);
        return w >= 2 && hh >= 2;
      })
      .map((l) => ({
        node: l.data,
        x: l.x0 ?? 0,
        y: l.y0 ?? 0,
        w: (l.x1 ?? 0) - (l.x0 ?? 0),
        h: (l.y1 ?? 0) - (l.y0 ?? 0),
        rank: rankMap.get(l.data.path) ?? 999
      }));
  }, [node, size]);

  if (!rects || rects.length === 0) {
    return (
      <div ref={containerRef} className="treemap-container treemap-empty">
        <div>This folder is empty.</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="treemap-container">
      {rects.map((r) => {
        const color = r.rank < PALETTE.length ? PALETTE[r.rank] : NEUTRAL;
        const isDir = r.node.type === 'dir';
        const showLabel = r.w > 36 && r.h > 22;
        const showSub = r.h > 40;
        const useBigLabel = r.w > 110 && r.h > 44;
        return (
          <div
            key={r.node.path}
            className={`treemap-rect${isDir ? ' clickable' : ''}`}
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              background: color.bg,
              color: color.fg
            }}
            onClick={() => {
              if (isDir) onDrillIn(r.node.path);
            }}
            onMouseEnter={(e) =>
              setHover({ node: r.node, x: e.clientX, y: e.clientY })
            }
            onMouseMove={(e) =>
              setHover({ node: r.node, x: e.clientX, y: e.clientY })
            }
            onMouseLeave={() => setHover(null)}
          >
            {showLabel && (
              <>
                <span
                  className="label"
                  style={{ fontSize: useBigLabel ? 13 : 11 }}
                >
                  {r.node.name}
                </span>
                {showSub && (
                  <span className="sublabel">{formatBytes(r.node.size)}</span>
                )}
              </>
            )}
          </div>
        );
      })}
      {hover && (
        <div
          className="treemap-tooltip"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="tooltip-name">{hover.node.name}</div>
          <div className="tooltip-meta">
            {hover.node.type === 'dir' ? 'Folder · ' : ''}
            {formatBytes(hover.node.size)}
          </div>
          <div className="tooltip-path">{hover.node.path}</div>
        </div>
      )}
    </div>
  );
}
