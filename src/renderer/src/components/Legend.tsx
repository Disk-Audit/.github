import type { Kind, KindRollup } from '../types';
import { KIND_META, formatBytes } from '../types';

interface Props {
  rollup: KindRollup;
  focusKind: Kind | null;
  setFocusKind: (k: Kind | null) => void;
}

export function Legend({ rollup, focusKind, setFocusKind }: Props): JSX.Element {
  const items = KIND_META
    .map((k) => ({ ...k, bytes: rollup[k.id as Kind] || 0 }))
    .filter((k) => k.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  const total = items.reduce((s, k) => s + k.bytes, 0) || 1;

  return (
    <aside className="legend">
      <h3>By type</h3>
      {items.length === 0 && (
        <div className="footnote" style={{ borderTop: 0 }}>— no files —</div>
      )}
      {items.map((k) => {
        const active = focusKind === k.id;
        const dim = focusKind !== null && !active;
        return (
          <button
            key={k.id}
            className={'kind' + (active ? ' active' : '') + (dim ? ' dim' : '')}
            style={{ ['--swatch' as string]: `var(--k-${k.id})` }}
            onClick={() => setFocusKind(active ? null : (k.id as Kind))}
            title={`${k.label} · ${formatBytes(k.bytes)} · ${((k.bytes / total) * 100).toFixed(1)}%`}
          >
            <div className="sw" />
            <div className="name">{k.label}</div>
            <div className="size">{formatBytes(k.bytes)}</div>
          </button>
        );
      })}
      <div className="footnote">click to filter the map · click again to clear</div>
    </aside>
  );
}
