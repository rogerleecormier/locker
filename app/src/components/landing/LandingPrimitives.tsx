import { useState } from "react";
import { FadeIn } from "./LandingAnimations";

export function Section({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <section
      className={`px-6 py-12 md:py-[100px] mx-auto w-full${className ? ` ${className}` : ""}`}
      style={{ maxWidth: "1040px", ...style }}
    >
      {children}
    </section>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14, background: "var(--accent-dim)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 20, padding: "4px 12px" }}>
      {children}
    </div>
  );
}

export function FeatureCard({ icon, title, desc, delay }: { icon: React.ReactNode; title: string; desc: string; delay?: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <FadeIn delay={delay}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ background: "var(--surface)", border: `1px solid ${hovered ? "rgba(168,85,247,0.4)" : "var(--border)"}`, borderRadius: 12, padding: "22px 20px", height: "100%", transition: "border-color 0.2s, transform 0.2s, box-shadow 0.2s", transform: hovered ? "translateY(-3px)" : "none", boxShadow: hovered ? "0 8px 24px rgba(168,85,247,0.12)" : "none", textAlign: "left" }}
      >
        <div style={{ marginBottom: 12 }}>{icon}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{desc}</div>
      </div>
    </FadeIn>
  );
}

export function Step({ num, title, desc, delay }: { num: string; title: string; desc: string; delay?: number }) {
  return (
    <FadeIn delay={delay} style={{ display: "flex", gap: 18, textAlign: "left" }}>
      <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: "50%", background: "var(--accent-dim)", border: "1px solid rgba(168,85,247,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>
        {num}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{desc}</div>
      </div>
    </FadeIn>
  );
}
