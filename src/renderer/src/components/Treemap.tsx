import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { hierarchy, treemap, treemapSquarify, type HierarchyNode } from 'd3-hierarchy';
import type { FsNode, Kind } from '../types';
import { kindFor, formatBytes } from '../types';

export type ColorMode = 'type' | 'depth' | 'heat';

interface TreemapProps {
  node: FsNode;
  mode: ColorMode;
  focusKind: Kind | null;
  onNavigate: (path: string) => void;
  depthLimit?: number;
}

interface Hover {
  data: FsNode;
  share: number;
  x: number;
  y: number;
}

interface AugmentedRoot extends HierarchyNode<FsNode> {
  __maxLeafValue?: number;
}

function clone(n: FsNode, depth: number, limit: number): FsNode {
  if (n.type === 'file') return n;
  if (depth >= limit) {
    // Collapse subtree into a single synthetic leaf to keep layout fast/readable
    return { ...n, type: 'file', children: undefined, ext: undefined };
  }
  return { ...n, children: (n.children || []).map((c) => clone(c, depth + 1, limit)) };
}

function topAncestor(n: HierarchyNode<FsNode>): HierarchyNode<FsNode> {
  let cur = n;
  while (cur.parent && cur.parent.parent) cur = cur.parent;
  return cur;
}

function colorForLeaf(
  leaf: HierarchyNode<FsNode>,
  mode: ColorMode,
  root: AugmentedRoot
): string {
  const node = leaf.data;
  if (mode === 'type') {
    const k = kindFor(node.ext);
    return `var(--k-${k})`;
  }
  if (mode === 'depth') {
    const top = topAncestor(leaf) as HierarchyNode<FsNode> & { index?: number };
    const idx = top.index ?? 0;
    const hue = (idx * 47 + 30) % 360;
    const l = Math.max(0.42, 0.70 - (leaf.depth - 1) * 0.05);
    return `oklch(${l.toFixed(2)} 0.13 ${hue})`;
  }
  // heat
  const v = leaf.value || 0;
  const maxV = root.__maxLeafValue || 1;
  const ratio = Math.min(1, Math.log10(v + 1) / Math.log10(maxV + 1));
  const hue = (1 - ratio) * 220 + ratio * 25;
  const l = 0.5 + ratio * 0.2;
  const c = 0.1 + ratio * 0.1;
  return `oklch(${l.toFixed(2)} ${c.toFixed(2)} ${hue})`;
}

function truncate(s: string, maxPx: number, fontSize: number): string {
  const charPx = fontSize * 0.6;
  const max = Math.max(2, Math.floor(maxPx / charPx));
  if (s.length <= max) return s;
  if (max < 4) return s.slice(0, max);
  return s.slice(0, max - 1) + '…';
}

export function Treemap({
  node,
  mode,
  focusKind,
  onNavigate,
  depthLimit = 4
}: TreemapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) {
        setSize({ width: r.width, height: r.height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const { leaves, dirs, rootValue } = useMemo(() => {
    if (!node.children || node.children.length === 0) {
      return { leaves: [], dirs: [], rootValue: 0 };
    }

    const trimmed = clone(node, 0, depthLimit);

    const root = hierarchy<FsNode>(trimmed, (d) => d.children)
      .sum((d) => (d.children ? 0 : d.size))
      .sort((a, b) => (b.value || 0) - (a.value || 0)) as AugmentedRoot;

    if (root.children) {
      root.children.forEach((c, i) => {
        (c as HierarchyNode<FsNode> & { index?: number }).index = i;
      });
    }

    let maxLeaf = 0;
    root.each((n) => {
      if (!n.children && (n.value || 0) > maxLeaf) maxLeaf = n.value || 0;
    });
    root.__maxLeafValue = maxLeaf;

    const tm = treemap<FsNode>()
      .size([size.width, size.height])
      .tile(treemapSquarify.ratio(1.3))
      .paddingOuter(2)
      .paddingTop((n) => (n.depth === 0 ? 0 : 14))
      .paddingInner(1)
      .round(true);

    tm(root);

    const leavesArr = root.leaves().filter((l) => {
      const w = (l.x1 || 0) - (l.x0 || 0);
      const h = (l.y1 || 0) - (l.y0 || 0);
      return w >= 2 && h >= 2;
    });

    const dirsArr: HierarchyNode<FsNode>[] = [];
    root.each((n) => {
      if (n.depth > 0 && n.children && n.children.length) {
        const w = (n.x1 || 0) - (n.x0 || 0);
        const h = (n.y1 || 0) - (n.y0 || 0);
        if (w >= 30 && h >= 18) dirsArr.push(n);
      }
    });

    return { leaves: leavesArr, dirs: dirsArr, rootValue: root.value || 0 };
  }, [node, size, depthLimit]);

  const augmentedRoot: AugmentedRoot = useMemo(() => {
    // Reconstruct a tiny pseudo-root just for color lookup (depth mode uses top's index).
    // This is intentionally separate from the layout root above.
    const fake = { __maxLeafValue: 0 } as AugmentedRoot;
    let max = 0;
    for (const l of leaves) if ((l.value || 0) > max) max = l.value || 0;
    fake.__maxLeafValue = max;
    return fake;
  }, [leaves]);

  const handleHover = useCallback(
    (e: React.MouseEvent, leaf: HierarchyNode<FsNode>) => {
      setHover({
        data: leaf.data,
        share: rootValue > 0 ? ((leaf.value || 0) / rootValue) * 100 : 0,
        x: e.clientX,
        y: e.clientY
      });
    },
    [rootValue]
  );

  const handleLeave = useCallback(() => setHover(null), []);

  const handleClick = useCallback(
    (leaf: HierarchyNode<FsNode>) => {
      if (leaf.data.type === 'file' && leaf.parent && leaf.parent.data) {
        onNavigate(leaf.parent.data.path);
      } else if (leaf.data.type === 'dir') {
        onNavigate(leaf.data.path);
      }
    },
    [onNavigate]
  );

  if (leaves.length === 0) {
    return (
      <div ref={containerRef} className="treemap-container treemap-empty">
        — empty folder —
      </div>
    );
  }

  return (
    <div ref={containerRef} className="treemap-container">
      <svg width={size.width} height={size.height}>
        <defs>
          <linearGradient id="tile-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,.08)" />
            <stop offset="100%" stopColor="rgba(0,0,0,.08)" />
          </linearGradient>
        </defs>

        {dirs.map((dir) => {
          const x = dir.x0 || 0;
          const y = dir.y0 || 0;
          const w = (dir.x1 || 0) - x;
          const h = (dir.y1 || 0) - y;
          const showLabel = w > 60 && h > 24;
          return (
            <g key={'d-' + dir.data.path} transform={`translate(${x},${y})`}>
              <rect className="tile-dir-frame" width={w} height={h} rx={2} />
              {showLabel && (
                <text className="tile-dir-label" x={5} y={10}>
                  {truncate(dir.data.name, w - 10, 10)}
                </text>
              )}
            </g>
          );
        })}

        {leaves.map((leaf) => {
          const x = leaf.x0 || 0;
          const y = leaf.y0 || 0;
          const w = (leaf.x1 || 0) - x;
          const h = (leaf.y1 || 0) - y;
          const fill = colorForLeaf(leaf, mode, augmentedRoot);
          const dim =
            focusKind !== null && kindFor(leaf.data.ext) !== focusKind;
          const showLabel = w > 60 && h > 22;
          const showSize = w > 90 && h > 38;
          return (
            <g key={leaf.data.path} transform={`translate(${x},${y})`}>
              <rect
                className={'tile-rect' + (dim ? ' dim' : '')}
                width={w}
                height={h}
                fill={fill}
                rx={1.5}
                onMouseEnter={(e) => handleHover(e, leaf)}
                onMouseMove={(e) => handleHover(e, leaf)}
                onMouseLeave={handleLeave}
                onClick={() => handleClick(leaf)}
              />
              <rect
                width={w}
                height={h}
                fill="url(#tile-glow)"
                rx={1.5}
                pointerEvents="none"
              />
              {showLabel && (
                <text className="tile-label" x={6} y={14}>
                  {truncate(leaf.data.name, w - 12, 11)}
                </text>
              )}
              {showSize && (
                <text className="tile-size" x={6} y={28}>
                  {formatBytes(leaf.data.size)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover && (
        <div
          className="treemap-tooltip"
          style={{
            left: Math.min(window.innerWidth - 380, hover.x + 14),
            top: Math.min(window.innerHeight - 130, hover.y + 14),
            ['--swatch' as string]: `var(--k-${kindFor(hover.data.ext)})`
          }}
        >
          <div className="tt-name">{hover.data.name}</div>
          <div className="tt-row">
            <span>
              <span className="k">size </span>
              <span className="v">{formatBytes(hover.data.size)}</span>
            </span>
            <span>
              <span className="k">share </span>
              <span className="v">{hover.share.toFixed(2)}%</span>
            </span>
          </div>
          <div className="tt-kind">
            <span className="sw" /> {kindFor(hover.data.ext)}
            {hover.data.ext ? ` · .${hover.data.ext}` : ''}
          </div>
          <div className="tt-path">{hover.data.path}</div>
        </div>
      )}
    </div>
  );
}
