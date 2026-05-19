import { Logo } from './Logo';

interface TopBarProps {
  status?: React.ReactNode;
  right?: React.ReactNode;
}

export function TopBar({ status, right }: TopBarProps): JSX.Element {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-mark"><Logo size={20} /></span>
        <span>DISK ANALYZER</span>
        <span className="ver">v0.2</span>
      </div>
      <div className="brand-sep" />
      {status && <div className="meta">{status}</div>}
      <div className="spacer" />
      {right}
    </div>
  );
}
