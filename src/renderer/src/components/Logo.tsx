import type { CSSProperties } from 'react';

interface LogoProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Ledgeon brand mark — an "L" composed of three rectangles in the treemap
 * palette (blue / green / amber), with a small rose square nested inside the
 * amber to reference the treemap visualisation that defines the product.
 *
 * Designed to read at 16px (title bar) and stay recognisable at 256px+
 * (installer icons).
 */
export function Logo({ size = 24, className, style }: LogoProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-label="Ledgeon"
    >
      {/* Top square — treemap "info" blue */}
      <rect x="2" y="2" width="6" height="6" rx="0.5" fill="#6da4cc" />
      {/* Tall middle — treemap "success" green forms the vertical bar of the L */}
      <rect x="2" y="9" width="6" height="13" rx="0.5" fill="#7eb05f" />
      {/* Bottom horizontal — treemap "warning" amber forms the foot of the L */}
      <rect x="9" y="16" width="13" height="6" rx="0.5" fill="#c89a4e" />
    </svg>
  );
}
