import type { DriveInfo } from '../types';
import { formatBytes } from '../types';
import { TopBar } from './TopBar';

interface WelcomeProps {
  drives: DriveInfo[];
  drivesLoaded: boolean;
  error: string | null;
  onStart: (drivePath: string) => void;
}

function driveTypeLabel(t: DriveInfo['driveType']): string {
  return t === 'removable' ? 'Removable Disk' : 'Local Disk';
}

export function Welcome({ drives, drivesLoaded, error, onStart }: WelcomeProps): JSX.Element {
  return (
    <div className="shell fade-in">
      <TopBar
        status={
          <>
            <span className="dot" />
            <span>ready</span>
          </>
        }
      />
      <div className="welcome">
        <div className="welcome-left">
          <div className="welcome-eyebrow">// fast NTFS scanner · MFT-based</div>
          <h1 className="welcome-title">
            See where<br />your bytes <em>actually</em> went.
          </h1>
          <p className="welcome-sub">
            A precise map of every file on every drive. Hover any block to see its
            path and share of the volume. Drill in, sort, filter — find the 12&nbsp;GB
            cache you forgot about in 30 seconds.
          </p>
          <div className="welcome-feats">
            <div className="welcome-feat">
              <div className="n">01</div>
              <div>
                <div className="b">Reads the MFT directly</div>
                <div className="d">Millions of files indexed in seconds on NVMe.</div>
              </div>
            </div>
            <div className="welcome-feat">
              <div className="n">02</div>
              <div>
                <div className="b">Treemap that scales</div>
                <div className="d">Squarified layout, recursive folder framing.</div>
              </div>
            </div>
            <div className="welcome-feat">
              <div className="n">03</div>
              <div>
                <div className="b">Color by type, depth, or heat</div>
                <div className="d">Switch on the fly. Tooltips show byte share.</div>
              </div>
            </div>
            <div className="welcome-feat">
              <div className="n">04</div>
              <div>
                <div className="b">Read-only</div>
                <div className="d">Nothing is moved or deleted. You decide what's next.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="welcome-right">
          <h2>
            {drivesLoaded ? `Drives detected · ${drives.length}` : 'Detecting drives…'}
          </h2>

          {error && <div className="welcome-error">{error}</div>}

          {drivesLoaded && drives.length === 0 && (
            <p className="welcome-hint">No drives detected.</p>
          )}

          {drives.map((d) => {
            const used = Math.max(0, d.totalBytes - d.freeBytes);
            const pct = d.totalBytes > 0 ? (used / d.totalBytes) * 100 : 0;
            const isFull = pct >= 90;
            const typeLabel = driveTypeLabel(d.driveType);
            const displayName = d.label || typeLabel;
            return (
              <button
                key={d.letter}
                className="drive"
                onClick={() => onStart(d.letter + '\\')}
              >
                <div className="drive-letter">{d.letter}</div>
                <div className="drive-info">
                  <div className="drive-row1">
                    <span className="drive-name">{displayName}</span>
                    {d.fileSystem && <span className="drive-fs">{d.fileSystem}</span>}
                  </div>
                  {d.totalBytes > 0 ? (
                    <>
                      <div className="drive-bar">
                        <div
                          className={'fill' + (isFull ? ' full' : '')}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <div className="drive-stats">
                        <span><b>{formatBytes(used)}</b> used</span>
                        <span>{formatBytes(d.freeBytes)} free</span>
                        <span>{formatBytes(d.totalBytes)} total</span>
                      </div>
                    </>
                  ) : (
                    <div className="drive-stats">
                      <span>Size unavailable</span>
                    </div>
                  )}
                </div>
                <div className="drive-cta">Scan ›</div>
              </button>
            );
          })}

          <div className="welcome-foot">
            click a drive to scan · admin prompt may appear for NTFS read
          </div>
        </div>
      </div>
    </div>
  );
}
