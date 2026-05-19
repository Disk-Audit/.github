import { useMemo, useState, useRef, useEffect } from 'react';
import { hierarchy, treemap } from 'd3-hierarchy';
import type { FsNode } from '../types';
import { formatBytes } from '../types';

// Color palette grouped by file category. Tweak freely.
const EXT_COLORS: Record<string, string> = {
  // Video — warm red
  mp4: '#e53e3e', mkv: '#e53e3e', avi: '#e53e3e', mov: '#e53e3e',
  webm: '#e53e3e', wmv: '#e53e3e', flv: '#e53e3e', m4v: '#e53e3e',
  // Image — orange
  jpg: '#dd6b20', jpeg: '#dd6b20', png: '#dd6b20', gif: '#dd6b20',
  webp: '#dd6b20', heic: '#dd6b20', bmp: '#dd6b20', tiff: '#dd6b20', svg: '#dd6b20',
  // Audio — purple
  mp3: '#805ad5', flac: '#805ad5', wav: '#805ad5', aac: '#805ad5',
  ogg: '#805ad5', m4a: '#805ad5', opus: '#805ad5',
  // Archive — teal
  zip: '#319795', rar: '#319795', '7z': '#319795', tar: '#319795',
  gz: '#319795', bz2: '#319795', xz: '#319795',
  // Document — slate
  pdf: '#c53030', docx: '#2b6cb0', doc: '#2b6cb0',
  xlsx: '#2f855a', xls: '#2f855a', csv: '#2f855a',
  pptx: '#c05621', ppt: '#c05621',
  txt: '#718096', md: '#718096', rtf: '#718096',
  // Code — yellow/blue
  js: '#d69e2e', ts: '#3182ce', jsx: '#d69e2e', tsx: '#3182ce',
  py: '#3182ce', rb: '#e53e3e', java: '#dd6b20', cs: '#553c9a',
  cpp: '#3182ce', c: '#3182ce', h: '#3182ce', go: '#3182ce',
  rs: '#dd6b20', html: '#dd6b20', css: '#3182ce', scss: '#d53f8c',
  json: '#718096', xml: '#718096', yaml: '#718096', yml: '#718096',
  // Executables — dark slate
  exe: '#2d3748', dll: '#2d3748', msi: '#2d3748', bat: '#2d3748',
  sys: '#2d3748', com: '#2d3748',
  // Disk images / VMs
  iso: '#4a5568', vhd: '#4a5568', vhdx: '#4a5568', vmdk: '#4a5568'
};

function colorFor(node: FsNode): string {
  if (node.type === 'dir') return '#4a5568';
  if (node.ext && EXT_COLORS[node.ext]) return EXT_COLORS[node.ext];
  return '#a0aec0'; // unknown / generic
}

interface TreemapProps {
  node: FsNode;
  onSelect: (path: string) => void;
}

interface Hover {
  node: FsNode;
  x: number;
  y: number;
}

export function Treemap({ node, onSelect }: TreemapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hover, setHover] = useState<Hover | null>(null);

  // Track container size for responsive layout
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      // Avoid zero-size renders during layout shifts
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!node.children || node.children.length === 0) return null;

    const root = hierarchy(node, (d) => d.children)
      .sum((d) => (d.children ? 0 : d.size))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    treemap<FsNode>()
      .size([size.width, size.height])
      .paddingOuter(2)
      .paddingInner(1)
      .round(true)(root);

    // Drop rectangles too small to be visible — huge speedup for big trees
    return root.leaves().filter((leaf) => {
      const w = (leaf.x1 ?? 0) - (leaf.x0 ?? 0);
      const h = (leaf.y1 ?? 0) - (leaf.y0 ?? 0);
      return w >= 2 && h >= 2;
    });
  }, [node, size]);

  if (!layout || layout.length === 0) {
    return (
      <div ref={containerRef} className="treemap-container treemap-empty">
        <div>Nothing to show here.</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="treemap-container">
      <svg width={size.width} height={size.height}>
        {layout.map((leaf, i) => {
          const x = leaf.x0 ?? 0;
          const y = leaf.y0 ?? 0;
          const w = (leaf.x1 ?? 0) - x;
          const h = (leaf.y1 ?? 0) - y;
          const showLabel = w > 60 && h > 20;
          const isActive = hover?.node.path === leaf.data.path;
          return (
            <g key={`${leaf.data.path}-${i}`} transform={`translate(${x},${y})`}>
              <rect
                width={w}
                height={h}
                fill={colorFor(leaf.data)}
                stroke={isActive ? '#f6e05e' : '#0f1419'}
                strokeWidth={isActive ? 2 : 0.5}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) =>
                  setHover({ node: leaf.data, x: e.clientX, y: e.clientY })
                }
                onMouseMove={(e) =>
                  setHover({ node: leaf.data, x: e.clientX, y: e.clientY })
                }
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  // Navigate the file-list pane to this file's parent directory
                  const parent = leaf.parent;
                  if (parent && parent.data.type === 'dir') {
                    onSelect(parent.data.path);
                  }
                }}
              />
              {showLabel && (
                <text
                  x={5}
                  y={14}
                  fill="white"
                  fontSize={11}
                  fontFamily="'JetBrains Mono', 'Consolas', monospace"
                  style={{
                    pointerEvents: 'none',
                    textShadow: '0 1px 2px rgba(0,0,0,0.6)'
                  }}
                >
                  {leaf.data.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          className="treemap-tooltip"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="name">{hover.node.name}</div>
          <div className="size">{formatBytes(hover.node.size)}</div>
          <div className="path">{hover.node.path}</div>
        </div>
      )}
    </div>
  );
}
