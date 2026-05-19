import { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  FsNode,
  ScanProgress as ScanProgressType,
  DriveInfo
} from './types';
import { Treemap } from './components/Treemap';
import { FileList } from './components/FileList';
import { Breadcrumbs } from './components/Breadcrumbs';
import { ScanProgress } from './components/ScanProgress';

function findNode(root: FsNode, targetPath: string): FsNode | null {
  if (root.path === targetPath) return root;
  if (!root.children) return null;
  for (const child of root.children) {
    const found = findNode(child, targetPath);
    if (found) return found;
  }
  return null;
}

export function App(): JSX.Element {
  const [root, setRoot] = useState<FsNode | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgressType>({
    bytes: 0,
    files: 0,
    currentPath: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [drivesLoaded, setDrivesLoaded] = useState(false);

  useEffect(() => {
    const unsub = window.api.onScanProgress((p) => setProgress(p));
    return unsub;
  }, []);

  useEffect(() => {
    window.api
      .listDrives()
      .then(setDrives)
      .finally(() => setDrivesLoaded(true));
  }, []);

  const currentNode = useMemo(() => {
    if (!root) return null;
    if (!currentPath) return root;
    return findNode(root, currentPath) || root;
  }, [root, currentPath]);

  const startScan = useCallback(async (drivePath: string) => {
    setError(null);
    setScanning(true);
    setProgress({ bytes: 0, files: 0, currentPath: drivePath });
    try {
      const result = await window.api.scan(drivePath);
      setRoot(result);
      setCurrentPath(result.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  const reset = useCallback(() => {
    setRoot(null);
    setCurrentPath(null);
    setError(null);
  }, []);

  if (scanning) {
    return <ScanProgress {...progress} />;
  }

  if (error) {
    return (
      <div className="welcome">
        <h1>Scan failed</h1>
        <p className="error">{error}</p>
        <button onClick={reset}>Try again</button>
      </div>
    );
  }

  if (!root || !currentNode) {
    return (
      <div className="welcome">
        <div className="logo">▮▯▮</div>
        <h1>Disk Analyzer</h1>
        <p>Pick a drive to scan.</p>
        {!drivesLoaded ? (
          <p className="hint">Detecting drives…</p>
        ) : drives.length === 0 ? (
          <p className="hint">No drives detected.</p>
        ) : (
          <div className="drive-picker">
            {drives.map((d) => (
              <button
                key={d.letter}
                className="drive-btn"
                onClick={() => startScan(d.letter + '\\')}
              >
                <span className="drive-btn-letter">{d.letter}</span>
                <span className="drive-btn-label">
                  {d.label || 'Local Disk'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <Breadcrumbs
          path={currentNode.path}
          rootPath={root.path}
          onNavigate={setCurrentPath}
        />
        <button onClick={reset}>New scan</button>
      </header>
      <main>
        <div className="treemap-pane">
          <Treemap node={currentNode} onSelect={setCurrentPath} />
        </div>
        <div className="list-pane">
          <FileList node={currentNode} onSelect={setCurrentPath} />
        </div>
      </main>
    </div>
  );
}
