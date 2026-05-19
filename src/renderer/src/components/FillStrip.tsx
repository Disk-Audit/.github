import type { Kind, KindRollup, DriveInfo } from '../types';
import { KIND_META, formatBytes } from '../types';

interface Props {
  rollup: KindRollup;
  drive: DriveInfo;
}

export function FillStrip({ rollup, drive }: Props): JSX.Element {
  const total = drive.totalBytes || 1;
  const used = Math.max(0, drive.totalBytes - drive.freeBytes);
  const free = drive.freeBytes;

  const segs = KIND_META
    .map((k) => ({ ...k, bytes: rollup[k.id as Kind] || 0 }))
    .filter((k) => k.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  // Whatever's "used by drive" but not yet accounted for by the scan
  // (because we may have hit some access errors). Show as an unattributed seg.
  const accounted = segs.reduce((s, k) => s + k.bytes, 0);
  const unaccounted = Math.max(0, used - accounted);

  return (
    <div className="fillstrip">
      <div className="fillstrip-meta">
        <div>
          <span className="used">{formatBytes(used)}</span>
          <span className="of">
            of {formatBytes(drive.totalBytes)} on {drive.letter}\
          </span>
        </div>
        <div>
          <span className="pct">{((used / total) * 100).toFixed(1)}%</span>
        </div>
      </div>
      <div className="fillbar">
        {segs.map((s) => (
          <div
            key={s.id}
            className="seg"
            style={{
              flex: s.bytes,
              background: `var(--k-${s.id})`
            }}
            title={`${s.label} · ${formatBytes(s.bytes)}`}
          />
        ))}
        {unaccounted > 0 && (
          <div
            className="seg"
            style={{ flex: unaccounted, background: 'var(--text-mute)' }}
            title={`Unaccounted (errors / skipped) · ${formatBytes(unaccounted)}`}
          />
        )}
        <div
          className="seg muted"
          style={{ flex: free }}
          title={`Free · ${formatBytes(free)}`}
        />
      </div>
    </div>
  );
}
