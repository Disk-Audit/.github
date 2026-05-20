import { formatBytes } from '../types';

interface Props {
  bytes: number;
  files: number;
  currentPath: string;
}

export function ScanProgress({ bytes, files, currentPath }: Props): JSX.Element {
  return (
    <div className="scan-progress">
      <div className="scan-progress-inner">
        <h2>Scanning…</h2>
        <div className="stats">
          <div className="stat">
            <span className="label">Scanned</span>
            <span className="value">{formatBytes(bytes)}</span>
          </div>
          <div className="stat">
            <span className="label">Files</span>
            <span className="value">{files.toLocaleString()}</span>
          </div>
        </div>
        <div className="indeterminate-bar">
          <div />
        </div>
        <div className="current-path" title={currentPath}>
          {currentPath || '\u00A0'}
        </div>
      </div>
    </div>
  );
}
