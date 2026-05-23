import type { FsNode } from '../types';
import { formatBytes } from '../types';

interface FolderHeaderProps {
  /** The folder currently being viewed. */
  node: FsNode;
  /** The scan root, used to compute path-relative-to-root and percentages. */
  root: FsNode;
}

/**
 * Counts real files in a subtree, respecting the "(N small files)" bucket
 * synthetic nodes the Rust walker emits. Same logic the status bar uses.
 */
function countFiles(n: FsNode): number {
  if (!n.children || n.children.length === 0) {
    const m = /^\((\d+) small files?\)$/.exec(n.name);
    return m ? parseInt(m[1], 10) : 1;
  }
  let c = 0;
  for (const child of n.children) c += countFiles(child);
  return c;
}

function countSubfolders(n: FsNode): number {
  if (!n.children) return 0;
  return n.children.filter((c) => c.type === 'dir').length;
}

export function FolderHeader({ node, root }: FolderHeaderProps): JSX.Element {
  const isRoot = node.path === root.path;
  const fileCount = countFiles(node);
  const folderCount = countSubfolders(node);
  const pctOfRoot = root.size > 0 ? (node.size / root.size) * 100 : 0;

  // The "relative" portion of the path — what's inside the scan root.
  // At the root itself we don't show a path row at all (the name already
  // says "C:" so a "C:\" subtitle is redundant). Deeper, we drop the root
  // prefix so the user sees "Users\you\Documents" not "C:\Users\you\…".
  let relative: string | null;
  if (isRoot) {
    relative = null;
  } else if (node.path.startsWith(root.path)) {
    const tail = node.path.slice(root.path.length).replace(/^[\\/]/, '');
    relative = tail || node.name;
  } else {
    relative = node.path;
  }

  return (
    <div className="folder-header">
      <div className="folder-header-name-row">
        <span className="folder-header-name">{node.name}</span>
        {!isRoot && (
          <span className="folder-header-pct" title="Percentage of total scan">
            {pctOfRoot.toFixed(1)}%
          </span>
        )}
      </div>
      {relative && (
        <div className="folder-header-path" title={node.path}>
          {relative}
        </div>
      )}
      <div className="folder-header-stats">
        <span className="folder-header-size">{formatBytes(node.size)}</span>
        <span className="folder-header-sep">·</span>
        <span>
          {fileCount.toLocaleString()} file{fileCount === 1 ? '' : 's'}
        </span>
        {folderCount > 0 && (
          <>
            <span className="folder-header-sep">·</span>
            <span>
              {folderCount.toLocaleString()} folder
              {folderCount === 1 ? '' : 's'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
