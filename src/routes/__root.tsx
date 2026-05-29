import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouter,
  Link,
} from "@tanstack/react-router";
import { QueryClientProvider, type QueryClient, useQuery } from "@tanstack/react-query";
import { getAdminStatus } from "~/routes/admin";
import { getUserWorkspaces } from "~/server/memoryFunctions";
import type { ReactNode } from "react";
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
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
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

  const isOrgAdmin = workspaces.some(
    (w) =>
      (w.type === "org" && (w.role === "owner" || w.role === "admin")) ||
      (w.type === "team" && w.role === "admin")
  );

  return (
    <nav style={navStyles.nav}>
      <div style={navStyles.brand}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
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
        <Link to="/settings" style={navStyles.link} activeProps={{ style: navStyles.linkActive }}>
          Settings
        </Link>
        {isOrgAdmin && (
          <Link to="/organization" style={navStyles.link} activeProps={{ style: navStyles.linkActive }}>
            Organization
          </Link>
        )}
        {adminStatus?.isAdmin && (
          <Link to="/admin" style={navStyles.link} activeProps={{ style: navStyles.linkActive }}>
            Site Admin
          </Link>
        )}
      </div>

      <div style={navStyles.right}>
        <span style={navStyles.userName}>{user.name || user.email}</span>
        <button onClick={handleSignOut} style={navStyles.signOut}>
          Sign out
        </button>
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
            --bg: #0f1117;
            --surface: #1a1d27;
            --surface2: #22263a;
            --border: #2e3250;
            --text: #e2e4f0;
            --text-muted: #7b80a0;
            --accent: #6366f1;
            --accent-hover: #818cf8;
            --accent-dim: rgba(99,102,241,0.15);
            --success: #22c55e;
            --error: #ef4444;
            --tag-bg: #1e2238;
            --tag-border: #3a3f6e;
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
