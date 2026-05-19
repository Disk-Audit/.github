interface BreadcrumbsProps {
  path: string;
  rootPath: string;
  onNavigate: (path: string) => void;
}

export function Breadcrumbs({
  path,
  rootPath,
  onNavigate
}: BreadcrumbsProps): JSX.Element | null {
  if (!path) return null;

  const sep = path.includes('\\') ? '\\' : '/';
  const rootParts = rootPath.split(/[\\/]/).filter(Boolean);
  const allParts = path.split(/[\\/]/).filter(Boolean);

  // First crumb represents the entire scan root
  const segments: { name: string; path: string }[] = [
    { name: rootParts[rootParts.length - 1] || rootPath, path: rootPath }
  ];

  // Append parts after the root, building up the full path as we go
  let current = rootPath;
  for (let i = rootParts.length; i < allParts.length; i++) {
    current = current + (current.endsWith(sep) ? '' : sep) + allParts[i];
    segments.push({ name: allParts[i], path: current });
  }

  return (
    <nav className="breadcrumbs" aria-label="Folder path">
      {segments.map((seg, i) => (
        <span key={seg.path} className="crumb-wrap">
          {i > 0 && <span className="sep">›</span>}
          <button
            type="button"
            className="crumb"
            onClick={() => onNavigate(seg.path)}
            disabled={i === segments.length - 1}
          >
            {seg.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
