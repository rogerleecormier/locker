import { ReactNode } from "react";

interface SectionProps {
  title: string;
  description?: string;
  icon?: string;
  children: ReactNode;
}

export function SiteAdminSection({ title, description, icon, children }: SectionProps) {
  return (
    <section style={styles.siteSection}>
      <div style={styles.sectionHeader}>
        {icon && <span style={styles.icon}>{icon}</span>}
        <div>
          <h2 style={styles.sectionTitle}>{title}</h2>
          {description && <p style={styles.description}>{description}</p>}
        </div>
      </div>
      <div style={styles.sectionContent}>{children}</div>
    </section>
  );
}

export function OrgAdminSection({ title, description, icon, children }: SectionProps) {
  return (
    <section style={styles.orgSection}>
      <div style={styles.sectionHeader}>
        {icon && <span style={styles.icon}>{icon}</span>}
        <div>
          <h2 style={styles.sectionTitle}>{title}</h2>
          {description && <p style={styles.description}>{description}</p>}
        </div>
      </div>
      <div style={styles.sectionContent}>{children}</div>
    </section>
  );
}

interface CardProps {
  children: ReactNode;
  status?: "success" | "error" | "warning" | "info";
}

export function AdminCard({ children, status }: CardProps) {
  return (
    <div style={{ ...styles.card, ...getStatusStyle(status) }}>
      {children}
    </div>
  );
}

interface StatProps {
  label: string;
  value: string | number;
  unit?: string;
}

export function StatBox({ label, value, unit }: StatProps) {
  return (
    <div style={styles.statBox}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>
        {value}
        {unit && <span style={styles.statUnit}>{unit}</span>}
      </div>
    </div>
  );
}

function getStatusStyle(status?: string) {
  const baseStyle = {
    borderLeft: "4px solid transparent",
  };

  switch (status) {
    case "success":
      return { ...baseStyle, borderLeftColor: "var(--success)", background: "rgba(34,197,94,0.04)" };
    case "error":
      return { ...baseStyle, borderLeftColor: "var(--error)", background: "rgba(239,68,68,0.04)" };
    case "warning":
      return { ...baseStyle, borderLeftColor: "#f59e0b", background: "rgba(245,158,11,0.04)" };
    case "info":
      return { ...baseStyle, borderLeftColor: "var(--accent)", background: "rgba(168,85,247,0.04)" };
    default:
      return baseStyle;
  }
}

const styles = {
  siteSection: {
    marginBottom: "32px",
    background: "linear-gradient(135deg, rgba(168,85,247,0.02) 0%, rgba(139,92,246,0.01) 100%)",
    border: "1px solid rgba(168,85,247,0.1)",
    borderRadius: "12px",
    padding: "24px",
  },
  orgSection: {
    marginBottom: "32px",
    background: "linear-gradient(135deg, rgba(34,197,94,0.02) 0%, rgba(16,185,129,0.01) 100%)",
    border: "1px solid rgba(34,197,94,0.1)",
    borderRadius: "12px",
    padding: "24px",
  },
  sectionHeader: {
    display: "flex" as const,
    alignItems: "flex-start",
    gap: "16px",
    marginBottom: "20px",
  },
  icon: {
    fontSize: "28px",
    display: "flex",
    alignItems: "center",
    marginTop: "2px",
  },
  sectionTitle: {
    margin: 0,
    fontSize: "18px",
    fontWeight: "bold" as const,
    color: "var(--text)",
  },
  description: {
    margin: "6px 0 0 0",
    fontSize: "13px",
    color: "var(--text-muted)",
    lineHeight: "1.5",
  },
  sectionContent: {
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: "16px",
  },
  card: {
    padding: "16px",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
  },
  statBox: {
    padding: "16px",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    display: "flex" as const,
    flexDirection: "column" as const,
    alignItems: "center",
    textAlign: "center" as const,
  },
  statLabel: {
    fontSize: "12px",
    color: "var(--text-muted)",
    marginBottom: "8px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  statValue: {
    fontSize: "28px",
    fontWeight: "bold" as const,
    color: "var(--accent)",
  },
  statUnit: {
    fontSize: "12px",
    marginLeft: "4px",
    color: "var(--text-muted)",
    fontWeight: "normal" as const,
  },
};
