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

  const segments: { name: string; path: string }[] = [
    { name: rootParts[rootParts.length - 1] || rootPath, path: rootPath }
  ];

  let current = rootPath;
  for (let i = rootParts.length; i < allParts.length; i++) {
    current = current + (current.endsWith(sep) ? '' : sep) + allParts[i];
    segments.push({ name: allParts[i], path: current });
  }

  return (
    <nav className="breadcrumbs" aria-label="Folder path">
      {segments.map((seg, i) => {
        const isCurrent = i === segments.length - 1;
        return (
          <span key={seg.path}>
            {i > 0 && <span className="sep">›</span>}
            <button
              type="button"
              className={`crumb${isCurrent ? ' current' : ''}`}
              onClick={() => !isCurrent && onNavigate(seg.path)}
              disabled={isCurrent}
              title={seg.path}
            >
              {seg.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
