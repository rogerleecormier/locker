import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

type ToastVariant = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  removing?: boolean;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, { bar: string; icon: string; label: string }> = {
  success: { bar: "#22c55e", icon: "✓", label: "Success" },
  error:   { bar: "#ef4444", icon: "✕", label: "Error" },
  warning: { bar: "#f59e0b", icon: "!", label: "Warning" },
  info:    { bar: "#6366f1", icon: "i", label: "Info" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, removing: true } : t));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const add = useCallback((message: string, variant: ToastVariant) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, variant }]);
    const timer = setTimeout(() => dismiss(id), 4000);
    timers.current.set(id, timer);
  }, [dismiss]);

  const value: ToastContextValue = {
    success: (m) => add(m, "success"),
    error:   (m) => add(m, "error"),
    warning: (m) => add(m, "warning"),
    info:    (m) => add(m, "info"),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 360,
        pointerEvents: "none",
      }}>
        {toasts.map((t) => {
          const v = VARIANT_STYLES[t.variant];
          return (
            <div
              key={t.id}
              role="alert"
              aria-live="polite"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderLeft: `3px solid ${v.bar}`,
                borderRadius: 8,
                padding: "10px 12px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                pointerEvents: "auto",
                animation: t.removing
                  ? "toastOut 0.3s ease-in forwards"
                  : "toastIn 0.3s ease-out forwards",
              }}
            >
              <span style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: v.bar,
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 1,
              }} aria-hidden="true">
                {v.icon}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: "var(--text)", lineHeight: 1.45 }}>
                {t.message}
              </span>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 16,
                  lineHeight: 1,
                  padding: "0 2px",
                  flexShrink: 0,
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes toastOut {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(24px); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
