import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouter,
  Link,
} from "@tanstack/react-router";
import { QueryClientProvider, type QueryClient, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAdminStatus } from "~/routes/admin";
import { getUserWorkspaces, getUserPlan, listNotifications, markNotificationRead } from "~/server/memoryFunctions";
import { PlanBadge } from "~/components/PaywallGate";
import type { PlanId } from "~/lib/plans";
import { type ReactNode, useState, useEffect, useRef } from "react";
import { useSession, signOut } from "~/lib/authClient";

interface RouterContext {
  queryClient: QueryClient;
}

const PUBLIC_PATHS = ["/", "/login", "/signup"];

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Locker — Memory Vault" },
    ],
    links: [
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
      <RootDocument>
        <AuthGate>
          <Outlet />
        </AuthGate>
      </RootDocument>
    </QueryClientProvider>
  );
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
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="url(#logo-grad-landing)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <defs>
            <linearGradient id="logo-grad-landing" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
          </defs>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeWidth="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeWidth="2" />
          <path d="M9 14.5h6M9 16.5h6M9 18.5h6M11 11v11M13 11v11" strokeWidth="1" opacity="0.6" />
          <rect x="9.5" y="14" width="5" height="5" rx="0.5" fill="var(--accent)" stroke="url(#logo-grad-landing)" strokeWidth="1" />
        </svg>
        <Link to="/" style={{ ...navStyles.brandName, textDecoration: "none", color: "var(--text)" }}>Locker</Link>
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
    await signOut();
    window.location.href = "/login";
  }

  const queryClient = useQueryClient();
  const [showNotifications, setShowNotifications] = useState(false);
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
      notificationsList.forEach((n) => seenIdsRef.current.add(n.id));
      isFirstRender.current = false;
      return;
    }

    const newUnread = notificationsList.filter(
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
  }, [notificationsList]);

  const currentPlan = (planData?.planId ?? "free") as PlanId;
  const unreadCount = notificationsList.filter((n) => n.status === "unread").length;

  return (
    <nav style={navStyles.nav}>
      <div style={navStyles.brand}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="url(#logo-grad-nav)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <defs>
            <linearGradient id="logo-grad-nav" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
          </defs>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeWidth="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeWidth="2" />
          <path d="M9 14.5h6M9 16.5h6M9 18.5h6M11 11v11M13 11v11" strokeWidth="1" opacity="0.6" />
          <rect x="9.5" y="14" width="5" height="5" rx="0.5" fill="var(--accent)" stroke="url(#logo-grad-nav)" strokeWidth="1" />
        </svg>
        <Link to="/" style={{ ...navStyles.brandName, textDecoration: "none", color: "var(--text)" }}>Locker</Link>
      </div>

      <div style={navStyles.links}>
        <Link to="/memories" style={navStyles.link} activeProps={{ style: navStyles.linkActive }}>
          Memories
        </Link>
        <Link to="/import" style={navStyles.link} activeProps={{ style: navStyles.linkActive }}>
          Import
        </Link>
        <Link to="/connect" style={navStyles.link} activeProps={{ style: navStyles.linkActive }}>
          Connect
        </Link>
        <Link to="/organization" style={navStyles.link} activeProps={{ style: navStyles.linkActive }}>
          Vault
        </Link>
        <Link to="/admin" style={navStyles.link} activeProps={{ style: navStyles.linkActive }}>
          Admin
        </Link>
      </div>

      <div style={navStyles.right}>
        {planData && <PlanBadge plan={currentPlan} />}

        {/* Notification Bell & Dropdown */}
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
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
            title="Notifications"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span style={{
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
                {notificationsList.length === 0 ? (
                  <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
                    No notifications yet.
                  </div>
                ) : (
                  notificationsList.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => {
                        markReadMut.mutate({ id: n.id });
                        setShowNotifications(false);
                        if (n.linkUrl) {
                          window.location.href = n.linkUrl;
                        }
                      }}
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--border)",
                        cursor: "pointer",
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
                      {n.status === "unread" && (
                        <div style={{
                          width: 6,
                          height: 6,
                          background: "var(--accent)",
                          borderRadius: "50%",
                          marginTop: 4,
                          flexShrink: 0
                        }} />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <span style={navStyles.userName}>{user.name || user.email}</span>
        <button onClick={handleSignOut} style={navStyles.signOut}>
          Sign out
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
                ×
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--text)", margin: 0, lineHeight: 1.4 }}>{t.message}</p>
          </div>
        ))}
      </div>
    </nav>
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
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          :root {
            --bg: #0b0914;
            --surface: #141221;
            --surface2: #1b182e;
            --border: #2e254d;
            --text: #f3f1f8;
            --text-muted: #8e85a6;
            --accent: #a855f7;
            --accent-hover: #c084fc;
            --accent-dim: rgba(168, 85, 247, 0.12);
            --success: #22c55e;
            --error: #ef4444;
            --tag-bg: #1c1538;
            --tag-border: #44357a;
            --radius: 8px;
            --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
          }
          body {
            background: var(--bg);
            color: var(--text);
            font-family: var(--font);
            font-size: 14px;
            line-height: 1.6;
            min-height: 100vh;
          }
          a { color: var(--accent); text-decoration: none; }
          a:hover { color: var(--accent-hover); }
          button {
            cursor: pointer;
            font-family: inherit;
            font-size: 13px;
            border: none;
            border-radius: var(--radius);
            transition: background 0.15s, color 0.15s, opacity 0.15s;
          }
          button:disabled { opacity: 0.5; cursor: not-allowed; }
          input, textarea, select {
            font-family: inherit;
            font-size: 13px;
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            color: var(--text);
            outline: none;
            transition: border-color 0.15s;
          }
          input:focus, textarea:focus, select:focus { border-color: var(--accent); }
          input::placeholder, textarea::placeholder { color: var(--text-muted); }
          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
