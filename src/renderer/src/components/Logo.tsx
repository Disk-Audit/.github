interface BrandMarkProps {
  size?: number;
}

export function Logo({ size = 22 }: BrandMarkProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Disk Analyzer"
    >
      <rect x="2" y="6" width="20" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
      <line x1="2" y1="9.5" x2="6" y2="9.5" stroke="currentColor" strokeWidth="1.4" />
      <line x1="2" y1="14.5" x2="6" y2="14.5" stroke="currentColor" strokeWidth="1.4" />
      <line x1="18" y1="9.5" x2="22" y2="9.5" stroke="currentColor" strokeWidth="1.4" />
      <line x1="18" y1="14.5" x2="22" y2="14.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
