import { Link } from "@tanstack/react-router";

interface LockerLogoProps {
  size?: number;
  linked?: boolean;
  className?: string;
  textClassName?: string;
}

/**
 * Round padlock icon — body is a circle (like the letter "O"),
 * shackle is a semicircular arc rising from the top.
 */
export function LockerPadlock({ size = 24 }: { size?: number }) {
  const gradId = `llg-${size}`;
  // Geometry (in a 32×32 viewBox):
  //   Circle body: cx=16, cy=22, r=9  → top=13, bottom=31
  //   Shackle arc: rises from y=13 up to y=5, radius=5
  //   We clip the SVG to 32×32 so the shackle peeks above the circle
  //   just like the ascender on a lowercase "o"/"b".
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 2 32 30"
      fill="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>

      {/* Shackle — compact U arc sitting just above the circle */}
      <path
        d="M11 14 L11 9 A5 5 0 0 1 21 9 L21 14"
        stroke={`url(#${gradId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Body — circle */}
      <circle
        cx="16" cy="22" r="9"
        stroke={`url(#${gradId})`}
        strokeWidth="2.5"
        fill="none"
      />

      {/* Keyhole */}
      <circle cx="16" cy="21" r="2" fill={`url(#${gradId})`} />
      <rect x="14.8" y="21" width="2.4" height="3.5" rx="1" fill={`url(#${gradId})`} />
    </svg>
  );
}

/**
 * "L[padlock]cker" wordmark — the round padlock replaces the "o".
 */
export function LockerLogo({ size = 18, linked = true, className, textClassName }: LockerLogoProps) {
  // Larger font so the lock reads as the "o" without being oversized
  const fontSize = Math.round(size * 1.15);
  const lockSize = Math.round(fontSize * 1.4);
  // Circle bottom is at y=31 in a 32-unit viewBox.
  // Shift the icon up so y=31 aligns with the text baseline.
  // translateY moves it up by (31/32 - 1) * lockSize = ~3% of lockSize.
  const nudgeUp = -Math.round(lockSize * 0.08);

  const wordmark = (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap: 0,
        letterSpacing: "-0.03em",
        fontWeight: 700,
        fontSize,
        lineHeight: 1,
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span className={textClassName} style={{ color: "var(--text, #f3f1f8)", lineHeight: 1, marginRight: -Math.round(lockSize * 0.11) }}>L</span>
      <LockerPadlock size={lockSize} />
      <span className={textClassName} style={{ color: "var(--text, #f3f1f8)", lineHeight: 1, marginLeft: -Math.round(lockSize * 0.11) }}>cker</span>
    </span>
  );

  if (!linked) return wordmark;

  return (
    <Link to="/" style={{ textDecoration: "none" }}>
      {wordmark}
    </Link>
  );
}
