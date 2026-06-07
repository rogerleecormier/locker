import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouter,
  Link,
} from "@tanstack/react-router";
import { QueryClientProvider, type QueryClient, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAdminStatus } from "~/routes/admin";
import { LockerLogo } from "~/components/LockerLogo";
import { getUserWorkspaces, getUserPlan, listNotifications, markNotificationRead } from "~/server/memoryFunctions";
import { PlanBadge } from "~/components/PaywallGate";
import type { PlanId } from "~/lib/plans";
import { type ReactNode, useState, useEffect, useRef } from "react";
import { useSession, signOut } from "~/lib/authClient";
import { cn } from "~/lib/utils";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { ToastProvider, useToast } from "~/components/ui/toast";
import "~/global.css";

interface RouterContext {
  queryClient: QueryClient;
}

const PUBLIC_PATHS = ["/", "/login", "/signup", "/pricing"];

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Locker — Personal Vault" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "shortcut icon", href: "/favicon.ico" },
    ],
  }),
  component: RootLayout,
});

function RootLayout() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RootDocument>
          <RootInner>
            <AuthGate>
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </AuthGate>
          </RootInner>
        </RootDocument>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function RootInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        router.navigate({ to: '/memories' });
      }
      if (e.shiftKey && e.key === '?') {
        e.preventDefault();
        toast.info('Keyboard Shortcuts: Cmd+K or Ctrl+K → Go to Memories | Shift+? → Show this help');
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [router, toast]);

  return <>{children}</>;
}

function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const { data: session, isPending } = useSession();

  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (isPending) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</span>
      </div>
    );
  }

  if (!session && !isPublic) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    return null;
  }

  if (session && (pathname === "/login" || pathname === "/signup")) {
    if (typeof window !== "undefined") {
      window.location.href = "/memories";
    }
    return null;
  }

  if (!session) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <LandingNav />
        <main style={{ flex: 1 }}>{children}</main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <Nav user={session.user} />
      <main style={{ flex: 1 }}>
        {children}
      </main>
    </div>
  );
}

const ADMIN_USER_ID = "r6T9s9AcwyaASSlextIlB07IgR5wwzKU";

function LandingNav() {
  return (
    <nav style={navStyles.nav}>
      <div style={navStyles.brand}>
        <LockerLogo size={18} />
      </div>
      <div style={{ flex: 1 }} />
      <div style={navStyles.right}>
        <Link to="/login" style={{ padding: "5px 12px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 6, fontSize: 12, textDecoration: "none" }}>
          Sign in
        </Link>
        <Link to="/signup" style={{ padding: "5px 12px", background: "var(--accent)", color: "#fff", borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
          Get started
        </Link>
      </div>
    </nav>
  );
}

function Nav({ user }: { user: { id: string; name: string; email: string } }) {
  async function handleSignOut() {
    try {
      await signOut();
    } catch (err) {
      console.error("[signOut] Unexpected error:", err);
    }
    window.location.href = "/login";
  }

  const queryClient = useQueryClient();
  const [showNotifications, setShowNotifications] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; title: string; message: string }>>([]);

  const { data: adminStatus } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
    staleTime: 60000,
  });

  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
    staleTime: 60000,
  });

  const { data: planData } = useQuery({
    queryKey: ["user-plan-v2"],
    queryFn: () => getUserPlan(),
    staleTime: 60000,
  });

  const { data: notificationsList = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(),
    refetchInterval: 15000, // poll every 15 seconds
  });

  const notifications = Array.isArray(notificationsList) ? notificationsList : [];

  const markReadMut = useMutation({
    mutationFn: (args: { id?: string; all?: boolean }) => markNotificationRead({ data: args }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const seenIdsRef = useRef<Set<string>>(new Set());
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      notifications.forEach((n) => seenIdsRef.current.add(n.id));
      isFirstRender.current = false;
      return;
    }

    const newUnread = notifications.filter(
      (n) => n.status === "unread" && !seenIdsRef.current.has(n.id)
    );

    if (newUnread.length > 0) {
      newUnread.forEach((n) => {
        seenIdsRef.current.add(n.id);
        const toastId = n.id;
        setToasts((prev) => [...prev, { id: toastId, title: n.title, message: n.message }]);
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== toastId));
        }, 5000);
      });
    }
  }, [notifications]);

  const currentPlan = (planData?.planId ?? "free") as PlanId;
  const unreadCount = notifications.filter((n) => n.status === "unread").length;

  return (
    <>
      <nav aria-label="Main navigation" className="flex items-center justify-between px-4 md:px-6 h-[52px] bg-surface border-b border-border sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 mr-4 select-none">
            <LockerLogo size={18} />
          </div>

          <div className="hidden md:flex items-center gap-1 select-none">
            <Link to="/memories" className="px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-all no-underline" activeProps={{ className: "text-text bg-surface2 font-semibold" }}>
              Memories
            </Link>
            <Link to="/templates" className="px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-all no-underline" activeProps={{ className: "text-text bg-surface2 font-semibold" }}>
              Templates
            </Link>
            <Link to="/import" className="px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-all no-underline" activeProps={{ className: "text-text bg-surface2 font-semibold" }}>
              Import
            </Link>
            <Link to="/organization" className="px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-all no-underline" activeProps={{ className: "text-text bg-surface2 font-semibold" }}>
              Team Space
            </Link>
            <Link to="/admin" className="px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-all no-underline" activeProps={{ className: "text-text bg-surface2 font-semibold" }}>
              Admin
            </Link>
            <Link to="/docs" className="px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-all no-underline" activeProps={{ className: "text-text bg-surface2 font-semibold" }}>
              Docs
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            {planData && <PlanBadge plan={currentPlan} />}
          </div>

          {/* Notification Bell & Dropdown */}
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label={unreadCount > 0 ? `Notifications — ${unreadCount} unread` : "Notifications"}
              aria-haspopup="true"
              aria-expanded={showNotifications}
              style={{
                background: "transparent",
                border: "none",
                color: showNotifications ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 6,
                borderRadius: 6,
                transition: "background 0.15s",
              }}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadCount > 0 && (
                <span aria-hidden="true" style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  background: "var(--error)",
                  color: "white",
                  fontSize: 9,
                  fontWeight: "bold",
                  borderRadius: "50%",
                  width: 14,
                  height: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div style={{
                position: "absolute",
                top: 36,
                right: 0,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                width: 320,
                boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                zIndex: 1000,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden"
              }}>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--surface2)"
                }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>Notifications</span>
                  {unreadCount > 0 && (
                    <button
                      onClick={() => markReadMut.mutate({ all: true })}
                      disabled={markReadMut.isPending}
                      style={{
                        background: "transparent",
                        color: "var(--accent)",
                        fontSize: 11,
                        border: "none",
                        padding: 0,
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div style={{
                  maxHeight: 280,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column"
                }}>
                  {notifications.length === 0 ? (
                    <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                      No notifications yet.
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          if (n.linkUrl) {
                            markReadMut.mutate({ id: n.id });
                            setShowNotifications(false);
                            window.location.href = n.linkUrl;
                          }
                        }}
                        style={{
                          padding: "10px 12px",
                          borderBottom: "1px solid var(--border)",
                          cursor: n.linkUrl ? "pointer" : "default",
                          background: n.status === "unread" ? "var(--accent-dim)" : "transparent",
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                          transition: "background 0.15s"
                        }}
                      >
                        <div style={{ flex: 1, textAlign: "left" }}>
                          <div style={{
                            fontSize: 12,
                            fontWeight: n.status === "unread" ? 700 : 500,
                            color: "var(--text)",
                            marginBottom: 2
                          }}>
                            {n.title}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                            {n.message}
                          </div>
                          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>
                            {new Date(n.createdAt).toLocaleDateString()} {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
                          {n.status === "unread" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                markReadMut.mutate({ id: n.id });
                              }}
                              disabled={markReadMut.isPending}
                              style={{
                                background: "transparent",
                                border: "1px solid var(--accent)",
                                color: "var(--accent)",
                                fontSize: 10,
                                padding: "2px 6px",
                                cursor: "pointer",
                                borderRadius: 4
                              }}
                              title="Mark as read"
                            >
                              ✓
                            </button>
                          )}
                          <div style={{
                            width: 6,
                            height: 6,
                            background: "var(--accent)",
                            borderRadius: "50%",
                            display: n.status === "unread" ? "block" : "none",
                            flexShrink: 0
                          }} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Desktop profile & sign out */}
          <div className="hidden md:flex items-center gap-3 select-none">
            <span className="text-xs text-text-muted truncate max-w-[160px] font-medium">{user.name || user.email}</span>
            <button onClick={handleSignOut} aria-label="Sign out of your account" className="px-3 py-1.5 border border-border text-text-muted hover:text-text hover:border-accent/40 rounded-lg text-xs font-medium bg-transparent cursor-pointer transition-colors">
              Sign out
            </button>
          </div>

          {/* Mobile menu trigger */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu"
            className="flex md:hidden items-center justify-center p-2 rounded-lg hover:bg-surface2 text-text-muted hover:text-text transition-colors cursor-pointer"
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
        </div>

        {/* Toast Popups Container */}
        <div style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 320
        }}>
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "12px 16px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                animation: "slideIn 0.3s ease-out forwards",
                position: "relative",
                overflow: "hidden",
                textAlign: "left"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 12, color: "var(--accent)" }}>{t.title}</span>
                <button
                  onClick={() => setToasts((prev) => prev.filter((toast) => toast.id !== t.id))}
                  aria-label="Dismiss notification"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--text-muted)",
                    fontSize: 16,
                    cursor: "pointer",
                    padding: "0 4px",
                    lineHeight: 1
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <p style={{ fontSize: 11, color: "var(--text)", margin: 0, lineHeight: 1.4 }}>{t.message}</p>
            </div>
          ))}
        </div>
      </nav>

      {/* Mobile Menu Drawer Overlay */}
      <div
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden transition-opacity duration-300",
          mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setMobileMenuOpen(false)}
      />

      {/* Mobile Menu Drawer Content */}
      <div
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          "fixed top-0 right-0 h-full w-[280px] bg-surface border-l border-border p-6 flex flex-col justify-between z-50 md:hidden transition-transform duration-300 ease-in-out transform shadow-2xl",
          mobileMenuOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 select-none">
              <LockerLogo size={18} />
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation menu"
              className="text-text-muted hover:text-text p-1 text-lg cursor-pointer"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          <div className="flex flex-col gap-1 select-none">
            <Link
              to="/memories"
              onClick={() => setMobileMenuOpen(false)}
              className="py-2.5 px-3 rounded-lg text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-colors no-underline"
              activeProps={{ className: "text-text bg-surface2 font-semibold" }}
            >
              Memories
            </Link>
            <Link
              to="/templates"
              onClick={() => setMobileMenuOpen(false)}
              className="py-2.5 px-3 rounded-lg text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-colors no-underline"
              activeProps={{ className: "text-text bg-surface2 font-semibold" }}
            >
              Templates
            </Link>
            <Link
              to="/import"
              onClick={() => setMobileMenuOpen(false)}
              className="py-2.5 px-3 rounded-lg text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-colors no-underline"
              activeProps={{ className: "text-text bg-surface2 font-semibold" }}
            >
              Import
            </Link>
            <Link
              to="/organization"
              onClick={() => setMobileMenuOpen(false)}
              className="py-2.5 px-3 rounded-lg text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-colors no-underline"
              activeProps={{ className: "text-text bg-surface2 font-semibold" }}
            >
              Team Space
            </Link>
            <Link
              to="/admin"
              onClick={() => setMobileMenuOpen(false)}
              className="py-2.5 px-3 rounded-lg text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-colors no-underline"
              activeProps={{ className: "text-text bg-surface2 font-semibold" }}
            >
              Admin
            </Link>
            <Link
              to="/docs"
              onClick={() => setMobileMenuOpen(false)}
              className="py-2.5 px-3 rounded-lg text-sm font-medium text-text-muted hover:text-text hover:bg-surface2 transition-colors no-underline"
              activeProps={{ className: "text-text bg-surface2 font-semibold" }}
            >
              Docs
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t border-border pt-6 select-none">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted truncate max-w-[180px] font-medium">
              {user.name || user.email}
            </span>
            {planData && <PlanBadge plan={currentPlan} />}
          </div>
          <button
            onClick={() => {
              setMobileMenuOpen(false);
              handleSignOut();
            }}
            className="w-full py-2 bg-transparent border border-border hover:border-error/45 text-text-muted hover:text-error rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}

const navStyles: Record<string, React.CSSProperties> = {
  nav: {
    display: "flex",
    alignItems: "center",
    gap: 0,
    padding: "0 24px",
    height: 52,
    background: "var(--surface)",
    borderBottom: "1px solid var(--border)",
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginRight: 28,
  },
  brandName: {
    fontWeight: 700,
    fontSize: 15,
    color: "var(--text)",
    letterSpacing: "-0.01em",
  },
  links: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flex: 1,
  },
  link: {
    padding: "6px 12px",
    borderRadius: 6,
    fontSize: 13,
    color: "var(--text-muted)",
    fontWeight: 500,
    transition: "color 0.15s, background 0.15s",
    textDecoration: "none",
  },
  linkActive: {
    color: "var(--text)",
    background: "var(--surface2)",
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  userName: {
    fontSize: 12,
    color: "var(--text-muted)",
    maxWidth: 160,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  signOut: {
    padding: "5px 12px",
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    borderRadius: 6,
    fontSize: 12,
    cursor: "pointer",
  },
};

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
