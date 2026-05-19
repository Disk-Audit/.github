import { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  FsNode,
  ScanProgress as ScanProgressType,
  DriveInfo,
  Kind
} from './types';
import { findByPath, rollupByKind, countFiles } from './types';
import { Welcome } from './components/Welcome';
import { ScanProgress } from './components/ScanProgress';
import { Breadcrumbs } from './components/Breadcrumbs';
import { Treemap, type ColorMode } from './components/Treemap';
import { FileList } from './components/FileList';
import { FillStrip } from './components/FillStrip';
import { Legend } from './components/Legend';
import { Logo } from './components/Logo';

type Stage = 'welcome' | 'scanning' | 'results';

export function App(): JSX.Element {
  // ── App-level state ─────────────────────────────────────────────────────
  const [stage, setStage] = useState<Stage>('welcome');
  const [root, setRoot] = useState<FsNode | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgressType>({
    bytes: 0,
    files: 0,
    currentPath: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [drivesLoaded, setDrivesLoaded] = useState(false);
  const [activeDrive, setActiveDrive] = useState<DriveInfo | null>(null);
  const [scanElapsedMs, setScanElapsedMs] = useState(0);

  // Results-view state
  const [focusKind, setFocusKind] = useState<Kind | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('type');
  const [depthLimit, setDepthLimit] = useState<3 | 4 | 5>(4);

  // ── Wire progress events ────────────────────────────────────────────────
  useEffect(() => {
    const unsub = window.api.onScanProgress((p) => setScanProgress(p));
    return unsub;
  }, []);

  // ── Load drives on mount ────────────────────────────────────────────────
  useEffect(() => {
    window.api
      .listDrives()
      .then(setDrives)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setDrivesLoaded(true));
  }, []);

  // ── Navigation ──────────────────────────────────────────────────────────
  const currentNode = useMemo(() => {
    if (!root) return null;
    if (!currentPath) return root;
    return findByPath(root, currentPath) || root;
  }, [root, currentPath]);

  const handleNavigate = useCallback((p: string) => setCurrentPath(p), []);

  // ── Start a scan ────────────────────────────────────────────────────────
  const startScan = useCallback(
    async (drivePath: string) => {
      setError(null);
      const drive =
        drives.find((d) => drivePath.startsWith(d.letter)) || null;
      setActiveDrive(drive);
      setStage('scanning');
      setScanProgress({ bytes: 0, files: 0, currentPath: drivePath });

      const t0 = Date.now();
      try {
        const result = await window.api.scan(drivePath);
        setRoot(result);
        setCurrentPath(result.path);
        setScanElapsedMs(Date.now() - t0);
        setStage('results');
        setFocusKind(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage('welcome');
      }
    },
    [drives]
  );

  // ── Reset to welcome ────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setRoot(null);
    setCurrentPath(null);
    setError(null);
    setFocusKind(null);
    setStage('welcome');
  }, []);

  // ── Rollups for the results view ────────────────────────────────────────
  const currentRollup = useMemo(
    () => (currentNode ? rollupByKind(currentNode) : {}),
    [currentNode]
  );
  const driveRollup = useMemo(
    () => (root ? rollupByKind(root) : {}),
    [root]
  );

  // ── Render by stage ─────────────────────────────────────────────────────

  if (stage === 'welcome' || !root || !currentNode) {
    return (
      <Welcome
        drives={drives}
        drivesLoaded={drivesLoaded}
        error={error}
        onStart={startScan}
      />
    );
  }

  if (stage === 'scanning') {
    return (
      <ScanProgress
        drivePath={
          activeDrive ? `${activeDrive.letter}\\` : scanProgress.currentPath
        }
        bytes={scanProgress.bytes}
        files={scanProgress.files}
        currentPath={scanProgress.currentPath}
      />
    );
  }

  // ── Results ─────────────────────────────────────────────────────────────
  const driveForStrip: DriveInfo =
    activeDrive || {
      letter: root.path.charAt(0) + ':',
      label: '',
      totalBytes: root.size,
      freeBytes: 0,
      fileSystem: '',
      driveType: 'fixed'
    };

  const totalFiles = countFiles(root);

  return (
    <div className="shell fade-in">
      <div className="app-header">
        <div className="brand">
          <span className="brand-mark"><Logo size={18} /></span>
          <span>DISK</span>
        </div>
        <Breadcrumbs
          path={currentNode.path}
          rootPath={root.path}
          onNavigate={handleNavigate}
        />
        <div className="actions">
          <button
            className="btn"
            onClick={() => setFocusKind(null)}
            disabled={focusKind === null}
          >
            {focusKind ? 'Clear filter' : 'No filter'}
          </button>
          <button className="btn primary" onClick={reset}>
            New scan
          </button>
        </div>
      </div>

      <FillStrip rollup={driveRollup} drive={driveForStrip} />

      <div className="results">
        <Legend
          rollup={currentRollup}
          focusKind={focusKind}
          setFocusKind={setFocusKind}
        />

        <section className="treemap-pane">
          <div className="treemap-toolbar">
            <span className="label">color</span>
            <div className="seg-group">
              {(['type', 'depth', 'heat'] as ColorMode[]).map((m) => (
                <button
                  key={m}
                  className={'seg-btn' + (colorMode === m ? ' active' : '')}
                  onClick={() => setColorMode(m)}
                >
                  {m === 'type' ? 'Type' : m === 'depth' ? 'Folder' : 'Heat'}
                </button>
              ))}
            </div>
            <span style={{ width: 12 }} />
            <span className="label">depth</span>
            <div className="seg-group">
              {([3, 4, 5] as const).map((n) => (
                <button
                  key={n}
                  className={'seg-btn' + (depthLimit === n ? ' active' : '')}
                  onClick={() => setDepthLimit(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <span className="crumb-mini">
              {focusKind
                ? `filter: ${focusKind} only`
                : 'click a tile to drill in'}
            </span>
          </div>
          <Treemap
            node={currentNode}
            mode={colorMode}
            focusKind={focusKind}
            onNavigate={handleNavigate}
            depthLimit={depthLimit}
          />
        </section>

        <FileList
          node={currentNode}
          focusKind={focusKind}
          onNavigate={handleNavigate}
        />
      </div>

      <div className="statusbar">
        <span className="ok">●</span>
        <span>scan complete</span>
        <span className="sep" />
        <span className="path">{currentNode.path}</span>
        <span className="spacer" />
        <span>{totalFiles.toLocaleString()} files indexed</span>
        <span className="sep" />
        <span>scan time {(scanElapsedMs / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
}
