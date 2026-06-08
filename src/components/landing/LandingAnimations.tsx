import { useEffect, useRef, useState } from "react";

export function useFadeIn(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  const { ref, visible } = useFadeIn();
  return (
    <div
      ref={ref}
      style={{
        minWidth: 0,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const { ref, visible } = useFadeIn(0.5);
  useEffect(() => {
    if (!visible) return;
    let start = 0;
    const step = to / 40;
    const id = setInterval(() => {
      start += step;
      if (start >= to) { setVal(to); clearInterval(id); }
      else setVal(Math.floor(start));
    }, 30);
    return () => clearInterval(id);
  }, [visible, to]);
  return <span ref={ref}>{val}{suffix}</span>;
}
