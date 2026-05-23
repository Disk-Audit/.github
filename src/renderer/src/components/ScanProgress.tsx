import { useEffect, useState } from 'react';
import { formatBytes } from '../types';

interface Props {
  bytes: number;
  files: number;
  currentPath: string;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return '< 1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs.toString().padStart(2, '0')}s`;
}

/**
 * Scan progress screen. The path being scanned is the focal point at the
 * top — that's what tells the user "the tool is alive and working through
 * your drive". Counts run as a quiet row below the progress bar in plain
 * text weight; they're informational, not the headline. The component is
 * mounted only during the scan, so we can safely start the elapsed-time
 * clock from its mount and tear it down on unmount.
 */
export function ScanProgress({ bytes, files, currentPath }: Props): JSX.Element {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 250);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="scan-progress">
      <div className="scan-progress-inner">
        <div className="scan-progress-caption">Scanning</div>

        <div className="scan-progress-path" title={currentPath}>
          {currentPath || '\u00A0'}
        </div>

        <div className="indeterminate-bar">
          <div />
        </div>

        <div className="scan-progress-row">
          <div className="scan-stat">
            <span className="scan-stat-num">{files.toLocaleString()}</span>
            <span className="scan-stat-unit">files</span>
          </div>
          <div className="scan-stat-sep">·</div>
          <div className="scan-stat">
            <span className="scan-stat-num">{formatBytes(bytes)}</span>
          </div>
          <div className="scan-stat-sep">·</div>
          <div className="scan-stat">
            <span className="scan-stat-num">{formatElapsed(elapsed)}</span>
            <span className="scan-stat-unit">elapsed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
