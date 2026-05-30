import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export type AdminSection = "system" | "site-config" | "billing-manage" | "orgs" | "users" | "teams";

interface MenuItem {
  id: AdminSection;
  label: string;
  icon: string;
  category: "site" | "org";
}

const MENU_ITEMS: MenuItem[] = [
  { id: "system", label: "System Overview", icon: "⚙️", category: "site" },
  { id: "site-config", label: "Configuration", icon: "🔧", category: "site" },
  { id: "billing-manage", label: "Billing Management", icon: "💳", category: "site" },
  { id: "orgs", label: "Organizations", icon: "🏢", category: "org" },
  { id: "users", label: "Users", icon: "👥", category: "org" },
  { id: "teams", label: "Teams", icon: "👤", category: "org" },
];

interface AdminLayoutProps {
  activeSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
  children: ReactNode;
}

export function AdminLayout({ activeSection, onSectionChange, children }: AdminLayoutProps) {
  const siteItems = MENU_ITEMS.filter((item) => item.category === "site");
  const orgItems = MENU_ITEMS.filter((item) => item.category === "org");

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div>
            <h1 style={styles.title}>Administration</h1>
            <p style={styles.subtitle}>Manage site-wide settings, billing, and organizations</p>
          </div>
          <Link to="/" style={styles.backLink}>← Back to App</Link>
        </div>
      </header>

      <div style={styles.layout}>
        <aside style={styles.sidebar}>
          <div style={styles.sidebarSection}>
            <h3 style={styles.sectionTitle}>
              <span style={styles.sectionIcon}>🌐</span>
              Site Administration
            </h3>
            <nav style={styles.nav}>
              {siteItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSectionChange(item.id)}
                  style={{
                    ...styles.navButton,
                    ...(activeSection === item.id ? styles.navButtonActive : styles.navButtonInactive),
                  }}
                >
                  <span style={styles.navIcon}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          <div style={{ ...styles.sidebarSection, marginTop: "32px", paddingTop: "24px", borderTop: "1px solid var(--border)" }}>
            <h3 style={styles.sectionTitle}>
              <span style={styles.sectionIcon}>🏢</span>
              Organization & Team Admin
            </h3>
            <nav style={styles.nav}>
              {orgItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSectionChange(item.id)}
                  style={{
                    ...styles.navButton,
                    ...(activeSection === item.id ? styles.navButtonActive : styles.navButtonInactive),
                  }}
                >
                  <span style={styles.navIcon}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        <main style={styles.mainContent}>
          {children}
        </main>
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
    transition: "opacity 0.2s ease",
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
    width: "260px",
    borderRight: "1px solid var(--border)",
    padding: "24px 0",
    background: "var(--surface)",
    position: "sticky" as const,
    top: 0,
    height: "calc(100vh - 76px)",
    overflowY: "auto" as const,
  },
  sidebarSection: {
    padding: "0 12px",
  },
  sectionTitle: {
    margin: "0 0 12px 0",
    fontSize: "11px",
    fontWeight: "bold" as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  sectionIcon: {
    fontSize: "14px",
  },
  nav: {
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: "4px",
  },
  navButton: {
    display: "flex" as const,
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "10px 12px",
    border: "none",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s ease",
    background: "transparent",
  },
  navButtonActive: {
    background: "var(--accent)",
    color: "white",
  },
  navButtonInactive: {
    color: "var(--text-muted)",
    hover: {
      background: "var(--surface2)",
    },
  },
  navIcon: {
    fontSize: "16px",
    display: "flex",
    alignItems: "center",
  },
  mainContent: {
    flex: 1,
    padding: "32px",
    overflowY: "auto" as const,
  },
};
