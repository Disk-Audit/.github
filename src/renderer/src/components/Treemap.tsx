import { useMemo, useState, useRef, useEffect } from 'react';
import { hierarchy, treemap, type HierarchyRectangularNode } from 'd3-hierarchy';
import type { FsNode } from '../types';
import { formatBytes } from '../types';

// Top 4 depth-1 children get the semantic palette; the rest fall back to
// neutral. The treemap palette is LOCKED — same colors in both themes.
// Using literal hex values lets the renderer paint without recomputing
// color-mix() for every rectangle on every frame.
const PALETTE = [
  { bg: '#6da4cc', fg: '#0a1f31' }, // info — blue
  { bg: '#c89a4e', fg: '#2c1f0a' }, // warning — amber
  { bg: '#7eb05f', fg: '#112a08' }, // success — green
  { bg: '#b86b8b', fg: '#2c0f1c' } //  danger — rose
];

const NEUTRAL = {
  bg: '#7f8590',
  fg: '#1a1d22'
};

// Max recursion depth for layout/rendering. 4 is enough that the eye reads
// "deeply nested" without producing thousands of sub-pixel boxes.
const MAX_DEPTH = 4;

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
  depth: number;
  rank: number;
  isLeaf: boolean;
  hasChildren: boolean;
}

/** Parse a #rrggbb string into [r,g,b]. Falls back to white on bad input. */
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim();
  if (h.length !== 6) return [255, 255, 255];
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0
  ];
}

function hex(r: number, g: number, b: number): string {
  const c = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Lerp baseBg toward tintTarget by ratio, in sRGB. */
function mixColors(baseBg: string, tintTarget: string, ratio: number): string {
  const [ar, ag, ab] = parseHex(baseBg);
  const [br, bg, bb] = parseHex(tintTarget);
  return hex(ar * (1 - ratio) + br * ratio, ag * (1 - ratio) + bg * ratio, ab * (1 - ratio) + bb * ratio);
}

/** Mix depth-1 color toward a theme-aware target as we go deeper. Result is
 * a literal hex string so the browser can paint without running color-mix. */
function tintForDepth(baseBg: string, depth: number, tintTarget: string): string {
  if (depth <= 1) return baseBg;
  const dilute = Math.min(15 + (depth - 1) * 20, 75) / 100;
  return mixColors(baseBg, tintTarget, dilute);
}

export function Treemap({ node, onDrillIn }: TreemapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hover, setHover] = useState<Hover | null>(null);
  const [tintTarget, setTintTarget] = useState<string>('#ffffff');

  // Re-read --treemap-tint-target whenever the theme attribute on <html>
  // changes. The result is a hex string we plug directly into JS color math
  // — no per-rectangle color-mix() at paint time.
  useEffect(() => {
    const readTint = (): void => {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue('--treemap-tint-target')
        .trim();
      if (v) setTintTarget(v);
    };
    readTint();
    const mo = new MutationObserver(readTint);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
    return () => mo.disconnect();
  }, []);

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

    // Rank top-level children by size so we can assign the palette tiers
    const sortedTopLevel = [...node.children].sort((a, b) => b.size - a.size);
    const rankMap = new Map<string, number>();
    sortedTopLevel.forEach((c, i) => rankMap.set(c.path, i));

    // Trim the tree at MAX_DEPTH — deeper levels would produce sub-pixel
    // boxes that we'd filter out anyway, and pruning keeps the layout fast.
    function prune(n: FsNode, depth: number): FsNode {
      if (!n.children || depth >= MAX_DEPTH) {
        return { ...n, children: undefined };
      }
      return {
        ...n,
        children: n.children.map((c) => prune(c, depth + 1))
      };
    }
    const prunedRoot = prune(node, 0);

    const h = hierarchy<FsNode>(prunedRoot, (d) => d.children)
      .sum((d) =>
        d.children && d.children.length > 0 ? 0 : Math.max(d.size, 0)
      )
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    treemap<FsNode>()
      .size([size.width, size.height])
      .paddingOuter(1)
      .paddingInner(1)
      // Carve a strip at the top of dir rects for labels. The depth-1 strip
      // is taller so the top-level folder names sit clearly above their
      // nested children.
      .paddingTop((n: HierarchyRectangularNode<FsNode>) => {
        if (n.depth === 0) return 0;
        if (n.depth === 1) return 18;
        if (n.depth === 2) return 14;
        return 0;
      })
      .round(true)(h);

    // Find the depth-1 ancestor's path so we can color by group
    function topAncestorPath(n: HierarchyRectangularNode<FsNode>): string {
      let cur: HierarchyRectangularNode<FsNode> | null = n;
      while (cur && cur.depth > 1) cur = cur.parent;
      return cur ? cur.data.path : '';
    }

    return h
      .descendants()
      .filter((n) => n.depth > 0)
      .filter((n) => {
        const w = (n.x1 ?? 0) - (n.x0 ?? 0);
        const hh = (n.y1 ?? 0) - (n.y0 ?? 0);
        return w >= 3 && hh >= 3;
      })
      .map((n) => ({
        node: n.data,
        x: n.x0 ?? 0,
        y: n.y0 ?? 0,
        w: (n.x1 ?? 0) - (n.x0 ?? 0),
        h: (n.y1 ?? 0) - (n.y0 ?? 0),
        depth: n.depth,
        rank: rankMap.get(topAncestorPath(n)) ?? 999,
        isLeaf: !n.children || n.children.length === 0,
        hasChildren: !!(n.children && n.children.length > 0)
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
        const isFreeSpace = r.node.kind === 'free-space';
        const swatch = isFreeSpace
          ? NEUTRAL
          : r.rank < PALETTE.length
            ? PALETTE[r.rank]
            : NEUTRAL;
        const isDir = r.node.type === 'dir';
        const isBucket = r.node.path.endsWith('\\__small_files_bucket__');
        // Free space, the small-files bucket, and leaves aren't clickable.
        const isClickable = isDir && !isBucket && !isFreeSpace;
        // Labels: top-level dirs always (room is reserved); deeper rects
        // only when they're large enough.
        const showLabel =
          (r.depth === 1 && r.w > 36 && r.h > 22) ||
          (r.depth === 2 && r.w > 50 && r.h > 28) ||
          (r.depth >= 3 && r.w > 80 && r.h > 30);
        const showSub = showLabel && r.h > 36 && !r.hasChildren;

        return (
          <div
            key={r.node.path}
            className={`treemap-rect${isClickable ? ' clickable' : ''}${r.hasChildren ? ' has-children' : ''}${isFreeSpace ? ' free-space' : ''}`}
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              // Free space uses a flat neutral hex (already set via NEUTRAL)
              // and doesn't get depth-tinted — it's always top-level anyway.
              background: isFreeSpace
                ? swatch.bg
                : tintForDepth(swatch.bg, r.depth, tintTarget),
              color: swatch.fg
            }}
            onClick={(e) => {
              if (isClickable) {
                e.stopPropagation();
                onDrillIn(r.node.path);
              }
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
                <span className="label" style={{ fontSize: r.depth === 1 ? 13 : 11 }}>
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
            {hover.node.kind === 'free-space'
              ? `Unused space · ${formatBytes(hover.node.size)}`
              : `${hover.node.type === 'dir' ? 'Folder · ' : ''}${formatBytes(hover.node.size)}`}
          </div>
          {hover.node.kind !== 'free-space' && (
            <div className="tooltip-path">{hover.node.path}</div>
          )}
        </div>
      )}
    </div>
  );
}
