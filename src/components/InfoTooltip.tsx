import React, { useState, useRef, useEffect } from "react";

interface InfoTooltipProps {
  text: string;
  size?: number;
}

export function InfoTooltip({ text, size = 14 }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<"above" | "below">("above");
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (visible && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos(rect.top < 80 ? "below" : "above");
    }
  }, [visible]);

  return (
    <span
      ref={ref}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", verticalAlign: "middle" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ cursor: "help", opacity: 0.6, flexShrink: 0 }}
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      {visible && (
        <span
          style={{
            position: "absolute",
            [pos === "above" ? "bottom" : "top"]: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--text)",
            lineHeight: 1.5,
            whiteSpace: "normal",
            width: 240,
            zIndex: 9999,
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
