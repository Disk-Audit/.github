import { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  FsNode,
  ScanProgress as ScanProgressType,
  DriveInfo
} from './types';
import { formatBytes } from './types';
import { Treemap } from './components/Treemap';
import { FileList } from './components/FileList';
import { Breadcrumbs } from './components/Breadcrumbs';
import { ScanProgress } from './components/ScanProgress';
import { DuplicateFinder } from './components/DuplicateFinder';
import { FileTypePanel } from './components/FileTypePanel';
import { Logo } from './components/Logo';
import { DriveSwitcher } from './components/DriveSwitcher';

// ----- Tree helpers -----

function findNode(root: FsNode, targetPath: string): FsNode | null {
  if (root.path === targetPath) return root;
  if (!root.children) return null;
  for (const child of root.children) {
    const found = findNode(child, targetPath);
    if (found) return found;
  }
  return null;
}

/**
 * Skip past "pass-through" directories — ones whose only entry is another
 * directory. Clicking "Users" with a single subfolder lands you in that
 * subfolder directly, so the treemap and list show something useful instead
 * of a single rectangle that fills the whole view.
 *
 * Rule: exactly one subdirectory at this level AND no real files (the
 * synthetic small-files aggregation bucket doesn't count — it's not real
 * content the user can interact with).
 */
function collapseSingleSubdirChain(node: FsNode): FsNode {
  let current = node;
  while (current.type === 'dir' && current.children) {
    const subdirs = current.children.filter((c) => c.type === 'dir');
    const realFiles = current.children.filter(
      (c) =>
        c.type === 'file' && !c.path.endsWith('\\__small_files_bucket__')
    );
    if (subdirs.length === 1 && realFiles.length === 0) {
      current = subdirs[0];
    } else {
      break;
    }
  }
  return current;
}

function findParent(
  root: FsNode,
  targetPath: string,
  parent: FsNode | null = null
): FsNode | null {
  if (root.path === targetPath) return parent;
  if (!root.children) return null;
  for (const child of root.children) {
    const found = findParent(child, targetPath, root);
    if (found) return found;
  }
  return null;
}

function countFiles(n: FsNode): number {
  if (n.type === 'file') {
    // The Rust walker rolls small files (<1 MiB) into synthetic buckets
    // named "(N small files)" or "(1 small file)" to keep the JSON manageable.
    // Parse the real count out of the name so the status bar reports the true
    // total instead of "1 per bucket".
    const m = /^\((\d+) small files?\)$/.exec(n.name);
    if (m) return parseInt(m[1], 10);
    return 1;
  }
  if (!n.children || n.children.length === 0) return 0;
  let c = 0;
  for (const child of n.children) c += countFiles(child);
  return c;
}

function driveTypeLabel(d: DriveInfo): string {
  if (d.driveType === 'removable') return 'Removable disk';
  if (d.mediaType === 'ssd') return 'Local SSD';
  if (d.mediaType === 'hdd') return 'Local HDD';
  return 'Local disk';
}

function getDriveForPath(p: string, drives: DriveInfo[]): DriveInfo | null {
  if (!p) return null;
  // On Windows, match by drive letter ("C:\Users\..." -> drive with letter "C:").
  if (/^[A-Za-z]:/.test(p)) {
    const letter = p.charAt(0).toUpperCase();
    return (
      drives.find((d) => d.letter.charAt(0).toUpperCase() === letter) || null
    );
  }
  // On Linux/macOS, match by the longest mount-point prefix.
  const candidates = drives
    .filter((d) => d.path && (p === d.path || p.startsWith(d.path + '/')))
    .sort((a, b) => b.path.length - a.path.length);
  return candidates[0] || null;
}

// ----- Navigation history -----

interface History {
  stack: string[];
  index: number;
}

// ----- Window chrome -----

function TitleBar({
  theme,
  onToggleTheme
}: {
  theme: Theme;
  onToggleTheme: () => void;
}): JSX.Element {
  return (
    <div className="titlebar">
      <Logo size={16} className="titlebar-logo" />
      <span className="titlebar-brand">
        Ledgeon <span className="titlebar-brand-dim">— Disk Analyzer</span>
      </span>
      <div className="titlebar-controls">
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          <i
            className={`ti ti-${theme === 'dark' ? 'sun' : 'moon'}`}
            aria-hidden="true"
          ></i>
        </button>
        <button
          onClick={() => window.api.windowMinimize()}
          aria-label="Minimize"
          title="Minimize"
        >
          <i className="ti ti-minus" aria-hidden="true"></i>
        </button>
        <button
          onClick={() => window.api.windowToggleMaximize()}
          aria-label="Maximize"
          title="Maximize"
        >
          <i className="ti ti-square" aria-hidden="true"></i>
        </button>
        <button
          className="close"
          onClick={() => window.api.windowClose()}
          aria-label="Close"
          title="Close"
        >
          <i className="ti ti-x" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  );
}

// ----- App -----

type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('ledgeon-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage might be unavailable in some sandboxed contexts
  }
  return 'dark';
}

export function App(): JSX.Element {
  const [root, setRoot] = useState<FsNode | null>(null);
  const [history, setHistory] = useState<History>({ stack: [], index: -1 });
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgressType>({
    bytes: 0,
    files: 0,
    currentPath: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [drivesLoaded, setDrivesLoaded] = useState(false);
  const [showDupes, setShowDupes] = useState(false);
  const [listView, setListView] = useState<'files' | 'types'>('files');
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  // Apply the theme to <html> and persist it
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('ledgeon-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

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

  const currentPath =
    history.index >= 0 ? history.stack[history.index] : null;

  const currentNode = useMemo<FsNode | null>(() => {
    if (!root) return null;
    const base = !currentPath ? root : findNode(root, currentPath) || root;
    return collapseSingleSubdirChain(base);
  }, [root, currentPath]);

  const totalFiles = useMemo(() => (root ? countFiles(root) : 0), [root]);

  const navigateTo = useCallback((path: string) => {
    setHistory((prev) => {
      // Drop forward history when navigating to a new spot
      const stack = [...prev.stack.slice(0, prev.index + 1), path];
      return { stack, index: stack.length - 1 };
    });
  }, []);

  const goBack = useCallback(() => {
    setHistory((prev) =>
      prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev
    );
  }, []);

  const goUp = useCallback(() => {
    if (!root || !currentNode) return;
    if (currentNode.path === root.path) return;
    const parent = findParent(root, currentNode.path);
    if (parent) navigateTo(parent.path);
  }, [root, currentNode, navigateTo]);

  const refresh = useCallback(() => {
    // Force re-render. A future version could re-scan the current folder.
    setHistory((prev) => ({ ...prev }));
  }, []);

  const runScan = useCallback(async (target: string) => {
    setError(null);
    setScanning(true);
    setProgress({ bytes: 0, files: 0, currentPath: target });
    try {
      const result = await window.api.scan(target);
      setRoot(result);
      setHistory({ stack: [result.path], index: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  const handleSelectFolder = useCallback(async () => {
    const folder = await window.api.chooseFolder();
    if (!folder) return;
    runScan(folder);
  }, [runScan]);

  // If launched from the OS context menu ("Scan with…"), the path is passed
  // through argv → main → IPC. Auto-scan it on startup.
  useEffect(() => {
    window.api.getLaunchPath().then((p) => {
      if (p) runScan(p);
    });
    const unsub = window.api.onScanPath((p) => runScan(p));
    return unsub;
  }, [runScan]);

  const reset = useCallback(() => {
    setRoot(null);
    setHistory({ stack: [], index: -1 });
    setError(null);
  }, []);

  // ----- Scanning view -----
  if (scanning) {
    return (
      <div className="app">
        <TitleBar theme={theme} onToggleTheme={toggleTheme} />
        <ScanProgress {...progress} />
      </div>
    );
  }

  // ----- Error view -----
  if (error) {
    return (
      <div className="app">
        <TitleBar theme={theme} onToggleTheme={toggleTheme} />
        <div className="welcome">
          <h1>Scan failed</h1>
          <div className="error">{error}</div>
          <button onClick={reset}>Try again</button>
        </div>
      </div>
    );
  }

  // ----- Welcome view -----
  if (!root || !currentNode) {
    return (
      <div className="app">
        <TitleBar theme={theme} onToggleTheme={toggleTheme} />
        <div className="welcome">
          <Logo size={64} className="welcome-logo" />
          <h1>
            Ledgeon{' '}
            <span className="welcome-h1-dim">— Disk Analyzer</span>
          </h1>
          <p className="welcome-tagline">
            Map every byte across your drives. See what's eating your storage,
            spot duplicates, and reclaim space — all from one place.
          </p>

          {!drivesLoaded ? (
            <p className="hint">Detecting drives…</p>
          ) : drives.length > 0 ? (
            <div className="drive-picker">
              {drives.map((d) => {
                const used = Math.max(0, d.totalBytes - d.freeBytes);
                const pct =
                  d.totalBytes > 0 ? (used / d.totalBytes) * 100 : 0;
                const isFull = pct >= 90;
                const typeLabel = driveTypeLabel(d);
                const displayName = d.label || typeLabel;

                return (
                  <button
                    key={d.path || d.letter}
                    className="drive-btn"
                    onClick={() => runScan(d.path)}
                  >
                    <div className="drive-btn-letter-col">
                      <div className="drive-btn-letter">{d.letter}</div>
                      {d.fileSystem && (
                        <div className="drive-btn-fs">{d.fileSystem}</div>
                      )}
                    </div>
                    <div className="drive-btn-info">
                      <div className="drive-btn-row1">
                        <div className="drive-btn-names">
                          <span className="drive-btn-name">{displayName}</span>
                          <span className="drive-btn-type">{typeLabel}</span>
                        </div>
                        {d.totalBytes > 0 ? (
                          <span
                            className={`drive-btn-free${isFull ? ' full' : ''}`}
                          >
                            {formatBytes(d.freeBytes)} free
                          </span>
                        ) : (
                          <span className="drive-btn-free drive-btn-free-dim">
                            Size unavailable
                          </span>
                        )}
                      </div>
                      {d.totalBytes > 0 && (
                        <>
                          <div className="drive-btn-stats">
                            <span className="drive-btn-used-label">Used</span>
                            <span className="drive-btn-used-value">
                              {formatBytes(used)}
                            </span>
                            <span className="drive-btn-stats-sep">/</span>
                            <span className="drive-btn-total">
                              {formatBytes(d.totalBytes)}
                            </span>
                            <span
                              className={`drive-btn-pct${isFull ? ' full' : ''}`}
                            >
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                          <div className="drive-btn-bar">
                            <div
                              className={`drive-btn-bar-fill${isFull ? ' full' : ''}`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}

          <button className="folder-btn" onClick={handleSelectFolder}>
            Or scan a specific folder…
          </button>
        </div>
      </div>
    );
  }

  // ----- Main results view -----
  const atRoot = currentNode.path === root.path;
  const canGoBack = history.index > 0;
  const canGoUp = !atRoot;
  const drive = getDriveForPath(root.path, drives);
  const capacityLabel =
    drive && drive.totalBytes > 0
      ? `${Math.round(((drive.totalBytes - drive.freeBytes) / drive.totalBytes) * 100)}% of ${formatBytes(drive.totalBytes)} used`
      : `Scanned ${formatBytes(root.size)}`;

  return (
    <div className="app">
      <TitleBar theme={theme} onToggleTheme={toggleTheme} />
      <div className="toolbar">
        <button
          className="nav-btn"
          onClick={goBack}
          disabled={!canGoBack}
          aria-label="Back"
          title="Back"
        >
          <i className="ti ti-arrow-left" aria-hidden="true"></i>
        </button>
        <button
          className="nav-btn"
          onClick={goUp}
          disabled={!canGoUp}
          aria-label="Up one level"
          title="Up one level"
        >
          <i className="ti ti-arrow-up" aria-hidden="true"></i>
        </button>
        <button
          className="nav-btn"
          onClick={refresh}
          aria-label="Refresh"
          title="Refresh"
        >
          <i className="ti ti-refresh" aria-hidden="true"></i>
        </button>
        <Breadcrumbs
          path={currentNode.path}
          rootPath={root.path}
          onNavigate={navigateTo}
        />
        <div className="toolbar-spacer"></div>
        <button
          className="dupe-btn"
          onClick={() => setShowDupes(true)}
          title="Find duplicate files in the current folder"
        >
          <i className="ti ti-copy" aria-hidden="true"></i>
          <span>Find duplicates</span>
        </button>
        <DriveSwitcher
          drives={drives}
          currentPath={root.path}
          onPick={(p) => runScan(p)}
          onChooseFolder={handleSelectFolder}
        />
      </div>
      <div className="body">
        <div className="treemap-pane">
          <Treemap node={currentNode} onDrillIn={navigateTo} />
        </div>
        <div className="list-pane">
          <div className="list-pane-tabs">
            <button
              className={`list-pane-tab${listView === 'files' ? ' active' : ''}`}
              onClick={() => setListView('files')}
            >
              <i className="ti ti-file" aria-hidden="true"></i> Files
            </button>
            <button
              className={`list-pane-tab${listView === 'types' ? ' active' : ''}`}
              onClick={() => setListView('types')}
            >
              <i className="ti ti-chart-pie" aria-hidden="true"></i> Types
            </button>
          </div>
          {listView === 'files' ? (
            <FileList
              node={currentNode}
              onDrillIn={navigateTo}
              onFileTrashed={() => runScan(root.path)}
            />
          ) : (
            <FileTypePanel node={currentNode} />
          )}
        </div>
      </div>
      <div className="status-bar">
        <span>
          <i className="ti ti-check check-icon" aria-hidden="true"></i>
          {totalFiles.toLocaleString()} files scanned
        </span>
        <span>
          {currentNode.name}: {formatBytes(currentNode.size)}
        </span>
        <div className="status-spacer"></div>
        {drive && (
          <>
            <span className="status-drive">
              <i className="ti ti-device-desktop" aria-hidden="true"></i>
              {drive.label || drive.path}
              <span className="dim">
                {' · '}
                {drive.driveType === 'removable'
                  ? 'Removable'
                  : drive.mediaType === 'ssd'
                    ? 'SSD'
                    : drive.mediaType === 'hdd'
                      ? 'HDD'
                      : 'Local'}
                {drive.fileSystem ? ` · ${drive.fileSystem}` : ''}
              </span>
            </span>
            {drive.totalBytes > 0 && (
              <span className="status-free">
                <span className="dim">free </span>
                {formatBytes(drive.freeBytes)}
              </span>
            )}
          </>
        )}
        <span>{capacityLabel}</span>
      </div>
      {showDupes && (
        <DuplicateFinder
          folderPath={currentNode.path}
          onClose={() => setShowDupes(false)}
          onAfterDelete={() => {
            // Only re-scan when files were actually removed
            if (root) runScan(root.path);
          }}
        />
      )}
    </div>
  );
}
