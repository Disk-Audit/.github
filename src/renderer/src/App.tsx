import { useState, useEffect, useMemo, useCallback } from 'react';
import type { FsNode, ScanProgress as ScanProgressType } from './types';
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

  useEffect(() => {
    const unsub = window.api.onScanProgress((p) => setProgress(p));
    return unsub;
  }, []);

  const currentNode = useMemo(() => {
    if (!root) return null;
    if (!currentPath) return root;
    return findNode(root, currentPath) || root;
  }, [root, currentPath]);

  const handleSelectFolder = useCallback(async () => {
    setError(null);
    const folder = await window.api.chooseFolder();
    if (!folder) return;
    setScanning(true);
    setProgress({ bytes: 0, files: 0, currentPath: folder });
    try {
      const result = await window.api.scan(folder);
      setRoot(result);
      setCurrentPath(result.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  if (scanning) {
    return <ScanProgress {...progress} />;
  }

  if (error) {
    return (
      <div className="welcome">
        <h1>Scan failed</h1>
        <p className="error">{error}</p>
        <button onClick={handleSelectFolder}>Try again</button>
      </div>
    );
  }

  if (!root || !currentNode) {
    return (
      <div className="welcome">
        <div className="logo">▮▯▮</div>
        <h1>Disk Analyzer</h1>
        <p>Pick a folder or drive to see what's eating your space.</p>
        <button className="primary" onClick={handleSelectFolder}>
          Choose folder…
        </button>
        <p className="hint">
          Tip: scan an entire drive by selecting <code>C:\</code>, or pick a single
          folder to narrow it down.
        </p>
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
        <button onClick={handleSelectFolder}>New scan</button>
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
