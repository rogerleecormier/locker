// Shared primitives used across all docs section components
import type { ReactNode } from "react";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
      {children}
    </h2>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return (
    <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
      {children}
    </p>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
      {children}
    </h3>
  );
}

export function Card({ children, accent }: { children: ReactNode; accent?: "purple" | "blue" | "green" | "orange" }) {
  const colors: Record<string, { bg: string; border: string }> = {
    purple: { bg: "rgba(168,85,247,0.04)", border: "rgba(168,85,247,0.15)" },
    blue:   { bg: "rgba(59,130,246,0.04)", border: "rgba(59,130,246,0.15)" },
    green:  { bg: "rgba(16,185,129,0.04)", border: "rgba(16,185,129,0.15)" },
    orange: { bg: "rgba(184,92,56,0.06)",  border: "rgba(184,92,56,0.25)" },
  };
  const c = accent ? colors[accent] : { bg: "var(--surface2)", border: "var(--border)" };
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 20 }}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 8px 0", display: "flex", alignItems: "center", gap: 8 }}>
      {children}
    </h4>
  );
}

export function CardBody({ children }: { children: ReactNode }) {
  return (
    <div style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
      {children}
    </div>
  );
}

export function Grid({ children, min = 280 }: { children: ReactNode; min?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 16, marginBottom: 28 }}>
      {children}
    </div>
  );
}

interface StepItem { step: string; title: string; text: string }
export function StepList({ items }: { items: StepItem[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
      {items.map((s) => (
        <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
          <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, border: "1px solid rgba(168,85,247,0.2)" }}>
            {s.step}
          </div>
          <div style={{ flex: 1 }}>
            <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface2)", marginBottom: 28, width: "100%", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left", minWidth: 500 }}>
        <thead>
          <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
            {headers.map((h) => (
              <th key={h} style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: ri < rows.length - 1 ? "1px solid var(--border)" : "none" }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: "12px 16px", color: "var(--text-muted)", lineHeight: 1.6 }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InfoBox({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: "rgba(168,85,247,0.05)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 12, padding: 16, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, display: "flex", alignItems: "center", gap: 12 }}>
      {children}
    </div>
  );
}

export function BulletList({ items }: { items: (string | ReactNode)[] }) {
  return (
    <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8, gap: 8, display: "flex", flexDirection: "column" }}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <>
      {label && <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, display: "block", marginBottom: 6 }}>{label}</span>}
      <pre style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--accent)", marginBottom: 16, overflowX: "auto" }}>{children}</pre>
    </>
  );
}
