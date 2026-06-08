import { PLATFORMS } from "~/lib/platforms";

export function PlatformScroller() {
  const pills = [...PLATFORMS, ...PLATFORMS];
  return (
    <div style={{ position: "relative", overflow: "hidden", width: "100%" }}>
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 64,
        background: "linear-gradient(to right, var(--bg, #0a0a0f), transparent)",
        zIndex: 1, pointerEvents: "none"
      }} />
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: 64,
        background: "linear-gradient(to left, var(--bg, #0a0a0f), transparent)",
        zIndex: 1, pointerEvents: "none"
      }} />
      <style>{`
        @keyframes scroll-left {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .platform-track {
          display: flex;
          gap: 8px;
          width: max-content;
          animation: scroll-left 32s linear infinite;
        }
        .platform-track:hover { animation-play-state: paused; }
      `}</style>
      <div className="platform-track">
        {pills.map((p, i) => (
          <div
            key={`${p.id}-${i}`}
            style={{
              padding: "5px 14px", borderRadius: 20,
              background: `${p.color}15`, border: `1px solid ${p.color}40`,
              color: p.color, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {p.label}
          </div>
        ))}
      </div>
    </div>
  );
}
