import { useEffect, useState } from 'react';
import { formatBytes } from '../types';
import { TopBar } from './TopBar';

interface Props {
  drivePath: string;
  bytes: number;
  files: number;
  currentPath: string;
}

function valueParts(n: number): [string, string] {
  if (n < 1024 ** 2) return [(n / 1024).toFixed(0), 'KB'];
  if (n < 1024 ** 3) return [(n / 1024 ** 2).toFixed(1), 'MB'];
  if (n < 1024 ** 4) return [(n / 1024 ** 3).toFixed(2), 'GB'];
  return [(n / 1024 ** 4).toFixed(2), 'TB'];
}

export function ScanProgress({ drivePath, bytes, files, currentPath }: Props): JSX.Element {
  const [bv, bu] = valueParts(bytes);
  const [elapsed, setElapsed] = useState(0);

  // Local stopwatch — independent of progress packets
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - start), 100);
    return () => window.clearInterval(id);
  }, []);

  const seconds = Math.floor(elapsed / 1000);
  const min = Math.floor(seconds / 60).toString().padStart(2, '0');
  const sec = (seconds % 60).toString().padStart(2, '0');
  const tenths = Math.floor((elapsed % 1000) / 100);

  return (
    <div className="shell fade-in">
      <TopBar
        status={
          <>
            <span
              className="dot"
              style={{
                background: 'var(--accent)',
                boxShadow: '0 0 0 3px var(--accent-dim)'
              }}
            />
            <span>scanning</span>
          </>
        }
      />
      <div className="scanning">
        <div className="scan-head">
          <div className="eyebrow">// reading $MFT · skipping reparse points</div>
          <h1>Scanning {drivePath}</h1>
          <div className="sub">
            Inventorying files without reading their contents. Stay put — this is fast.
          </div>
        </div>

        <div className="scan-body">
          <div className="scan-stats">
            <div className="scan-stat">
              <div className="label">Bytes indexed</div>
              <div className="value">
                {bv}
                <span className="unit"> {bu}</span>
              </div>
            </div>
            <div className="scan-stat">
              <div className="label">Files</div>
              <div className="value">{files.toLocaleString()}</div>
            </div>
            <div className="scan-stat">
              <div className="label">Elapsed</div>
              <div className="value">
                {min}:{sec}
                <span className="unit">.{tenths}</span>
              </div>
            </div>
            <div className="scan-progress-bar" />
          </div>

          <div className="scan-feed">
            <div className="scan-feed-inner">
              <div className="feed-current">
                <div className="lbl">Currently reading</div>
                <div className="path">{currentPath || drivePath}</div>
              </div>
              <div
                style={{
                  marginTop: 14,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-faint)',
                  lineHeight: 1.7
                }}
              >
                <div>· skipping symlinks and junctions</div>
                <div>· deduping by inode</div>
                <div>· grouping by extension</div>
                <div>
                  · {formatBytes(bytes)} consumed by{' '}
                  {files.toLocaleString()} files so far
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
