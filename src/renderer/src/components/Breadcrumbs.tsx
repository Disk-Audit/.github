import { Fragment } from 'react';

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

  const segments: { name: string; path: string; isRoot?: boolean }[] = [
    { name: rootPath, path: rootPath, isRoot: true }
  ];

  let current = rootPath;
  for (let i = rootParts.length; i < allParts.length; i++) {
    current = current + (current.endsWith(sep) ? '' : sep) + allParts[i];
    segments.push({ name: allParts[i], path: current });
  }

  return (
    <nav className="crumbs" aria-label="Folder path">
      {segments.map((s, i) => (
        <Fragment key={s.path}>
          {i > 0 && <span className="sep">›</span>}
          <button
            type="button"
            className={
              'crumb' +
              (s.isRoot ? ' root' : '') +
              (i === segments.length - 1 ? ' active' : '')
            }
            onClick={() => onNavigate(s.path)}
            disabled={i === segments.length - 1}
          >
            {s.name}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
