import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export type AdminSection =
  // Personal
  | "personal-account"
  | "personal-security"
  | "personal-sessions"
  | "personal-tokens"
  | "personal-mcp"
  | "personal-usage"
  | "personal-billing"
  | "personal-activity"
  | "personal-webhooks"
  // Org
  | "orgs"
  | "org-billing"
  | "org-audit-logs"
  | "users"
  | "teams"
  // Site
  | "system"
  | "site-config"
  | "billing-manage"
  | "site-audit-logs";

interface MenuItem {
  id: AdminSection;
  label: string;
  icon: string;
  category: "personal" | "org" | "site";
}

const MENU_ITEMS: MenuItem[] = [
  // Personal
  { id: "personal-account",  label: "My Account",      icon: "👤", category: "personal" },
  { id: "personal-security", label: "Security",        icon: "🔒", category: "personal" },
  { id: "personal-sessions", label: "Sessions",        icon: "🛡️", category: "personal" },
  { id: "personal-tokens",   label: "API Tokens",       icon: "🔑", category: "personal" },
  { id: "personal-mcp",      label: "MCP Endpoint",     icon: "🔌", category: "personal" },
  { id: "personal-usage",    label: "My Usage",         icon: "📈", category: "personal" },
  { id: "personal-billing",  label: "My Billing",       icon: "💳", category: "personal" },
  { id: "personal-activity", label: "Agent Activity",   icon: "◎",  category: "personal" },
  { id: "personal-webhooks", label: "Webhooks",          icon: "🔗", category: "personal" },
  // Org
  { id: "orgs", label: "Organizations", icon: "🏢", category: "org" },
  { id: "org-billing", label: "Org Billing", icon: "💰", category: "org" },
  { id: "org-audit-logs", label: "Audit Logs", icon: "📋", category: "org" },
  { id: "users", label: "Users", icon: "👥", category: "org" },
  { id: "teams", label: "Teams", icon: "👤", category: "org" },
  // Site
  { id: "system", label: "System Overview", icon: "⚙️", category: "site" },
  { id: "site-config", label: "Configuration", icon: "🔧", category: "site" },
  { id: "billing-manage", label: "Billing Management", icon: "📊", category: "site" },
  { id: "site-audit-logs", label: "All Org Logs", icon: "🔒", category: "site" },
];

const SECTIONS = [
  { key: "personal" as const, label: "Personal",                  icon: "👤" },
  { key: "org" as const,      label: "Organization & Team Admin", icon: "🏢" },
  { key: "site" as const,     label: "Site Administration",       icon: "🌐" },
];

interface AdminLayoutProps {
  activeSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
  children: ReactNode;
  /** User is admin/owner of at least one org — shows Org section */
  isOrgAdmin?: boolean;
  /** User is the site superadmin — shows Site section */
  isSiteAdmin?: boolean;
}

export function AdminLayout({ activeSection, onSectionChange, children, isOrgAdmin, isSiteAdmin }: AdminLayoutProps) {
  const activeMeta = MENU_ITEMS.find((m) => m.id === activeSection);
  const activeCategory = activeMeta?.category ?? "personal";

  const sectionVisible = (key: "personal" | "org" | "site") => {
    if (key === "org") return !!isOrgAdmin;
    if (key === "site") return !!isSiteAdmin;
    return true; // personal always visible
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div>
            <h1 style={styles.title}>Admin</h1>
            <p style={styles.subtitle}>Personal · Organization · Site</p>
          </div>
          <Link to="/" style={styles.backLink}>← Back to App</Link>
        </div>
      </header>

      <div style={styles.layout}>
        <aside style={styles.sidebar}>
          {SECTIONS.filter((s) => sectionVisible(s.key)).map((section, sectionIdx) => {
            const items = MENU_ITEMS.filter((m) => m.category === section.key);
            const isActive = activeCategory === section.key;
            return (
              <div
                key={section.key}
                style={{
                  ...styles.sidebarSection,
                  ...(sectionIdx > 0 ? { marginTop: "24px", paddingTop: "20px", borderTop: "1px solid var(--border)" } : {}),
                }}
              >
                <h3 style={styles.sectionTitle}>
                  <span style={styles.sectionIcon}>{section.icon}</span>
                  {section.label}
                </h3>
                <nav style={styles.nav}>
                  {items.map((item) => {
                    const active = activeSection === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onSectionChange(item.id)}
                        style={{
                          ...styles.navButton,
                          ...(active
                            ? {
                                background: section.key === "org" ? "var(--success)" : "var(--accent)",
                                color: "white",
                              }
                            : styles.navButtonInactive),
                        }}
                      >
                        <span style={styles.navIcon}>{item.icon}</span>
                        {item.label}
                      </button>
                    );
                  })}
                </nav>
              </div>
            );
          })}
        </aside>

        <main style={styles.mainContent}>{children}</main>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex" as const,
    flexDirection: "column" as const,
    minHeight: "100vh",
    background: "var(--surface)",
  },
  header: {
    background: "var(--surface2)",
    borderBottom: "1px solid var(--border)",
    padding: "24px 32px",
  },
  headerContent: {
    maxWidth: "1400px",
    margin: "0 auto",
    width: "100%",
    display: "flex" as const,
    justifyContent: "space-between" as const,
    alignItems: "flex-start" as const,
  },
  title: {
    margin: 0,
    fontSize: "28px",
    fontWeight: "bold" as const,
    color: "var(--text)",
  },
  subtitle: {
    margin: "4px 0 0 0",
    fontSize: "13px",
    color: "var(--text-muted)",
  },
  backLink: {
    color: "var(--accent)",
    fontSize: "14px",
    textDecoration: "none",
    fontWeight: 600,
    cursor: "pointer",
  },
  layout: {
    display: "flex" as const,
    flex: 1,
    maxWidth: "1400px",
    margin: "0 auto",
    width: "100%",
  },
  sidebar: {
    width: "240px",
    borderRight: "1px solid var(--border)",
    padding: "20px 0",
    background: "var(--surface)",
    position: "sticky" as const,
    top: 0,
    height: "calc(100vh - 76px)",
    overflowY: "auto" as const,
  },
  sidebarSection: {
    padding: "0 10px",
  },
  sectionTitle: {
    margin: "0 0 8px 0",
    fontSize: "10px",
    fontWeight: "bold" as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "6px",
    padding: "0 4px",
  },
  sectionIcon: {
    fontSize: "12px",
  },
  nav: {
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: "2px",
  },
  navButton: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "10px",
    width: "100%",
    padding: "9px 10px",
    border: "none",
    borderRadius: "7px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.15s ease",
    background: "transparent",
    textAlign: "left" as const,
  },
  navButtonInactive: {
    color: "var(--text-muted)",
  },
  navIcon: {
    fontSize: "14px",
    display: "flex" as const,
    alignItems: "center" as const,
  },
  mainContent: {
    flex: 1,
    padding: "32px",
    overflowY: "auto" as const,
  },
};
