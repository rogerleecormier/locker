import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@tanstack/react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import type { ReactNode } from "react";

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Locker — Memory Manager" },
    ],
  }),
  component: RootLayout,
});

function RootLayout() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <RootDocument>
        <Outlet />
      </RootDocument>
    </QueryClientProvider>
  );
}

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
        <ReactQueryDevtools buttonPosition="bottom-left" />
        <TanStackRouterDevtools position="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}
