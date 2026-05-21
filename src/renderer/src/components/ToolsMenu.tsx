import { useState, useEffect, useRef } from 'react';

export interface ToolsMenuProps {
  onFindDuplicates: () => void;
  showFreeSpace: boolean;
  onToggleFreeSpace: () => void;
}

/**
 * Toolbar dropdown housing cleanup tools and view preferences. Designed to
 * be the home for future scan tools (largest files, old files, CSV export,
 * empty folder finder, etc.) — each is a new item in the menu.
 */
export function ToolsMenu({
  onFindDuplicates,
  showFreeSpace,
  onToggleFreeSpace
}: ToolsMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="tools-menu" ref={rootRef}>
      <button
        className="tools-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Tools and view options"
      >
        <i className="ti ti-tool" aria-hidden="true"></i>
        <span>Tools</span>
        <i className="ti ti-chevron-down chevron" aria-hidden="true"></i>
      </button>

      {open && (
        <div className="tools-menu-panel" role="menu">
          <div className="tools-menu-section-header">Tools</div>
          <button
            className="tools-menu-item"
            onClick={() => {
              setOpen(false);
              onFindDuplicates();
            }}
          >
            <i className="ti ti-copy" aria-hidden="true"></i>
            <div className="tools-menu-item-text">
              <span className="tools-menu-item-title">Find duplicate files</span>
              <span className="tools-menu-item-desc">
                Locate byte-identical copies
              </span>
            </div>
          </button>

          <div className="tools-menu-section-header">View</div>
          <button
            className={`tools-menu-item tools-menu-toggle${showFreeSpace ? ' on' : ''}`}
            onClick={() => {
              onToggleFreeSpace();
            }}
            role="menuitemcheckbox"
            aria-checked={showFreeSpace}
          >
            <i
              className={`ti ti-${showFreeSpace ? 'square-check' : 'square'}`}
              aria-hidden="true"
            ></i>
            <div className="tools-menu-item-text">
              <span className="tools-menu-item-title">Show free space</span>
              <span className="tools-menu-item-desc">
                Include unused drive space in the treemap
              </span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
