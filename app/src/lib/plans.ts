export type PlanId = "free" | "business" | "business_comp" | "enterprise";

export type PlanLimits = {
  maxMemories: number;
  maxMonthlyRecalls: number;
  maxMonthlyCommits: number;
  maxMonthlyTokens: number;
  maxApiTokens: number;
  maxOrgMembers: number;
  maxTeams: number;
  maxTeamMembers: number;
};

export type PlanFeatures = {
  coreVault: boolean;
  semanticSearch: boolean;
  apiAccess: boolean;
  cliTool: boolean;
  conflictDetection: boolean;
  memoryHealth: boolean;
  bulkExport: boolean;
  organizations: boolean;
  teams: boolean;
  sharedVault: boolean;
  auditLogs: boolean;
  usageAnalytics: boolean;
  customProjectKeys: boolean;
  crossWorkspaceSearch: boolean;
  knowledgeGraph: boolean;
  priorityAI: boolean;
  advancedSecurityControls: boolean;
  byokEncryption: boolean;
  enterpriseSSO: boolean;
  dedicatedSupport: boolean;
};

export type Plan = {
  id: PlanId;
  label: string;
  price: string;
  priceNote: string;
  available: boolean;
  limits: PlanLimits;
  features: PlanFeatures;
  badge?: string;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    label: "Personal",
    price: "Free",
    priceNote: "Forever",
    available: true,
    limits: {
      maxMemories: 500,
      maxMonthlyRecalls: 2000,
      maxMonthlyCommits: 500,
      maxMonthlyTokens: 100000,
      maxApiTokens: 3,
      maxOrgMembers: 0,
      maxTeams: 0,
      maxTeamMembers: 0,
    },
    features: {
      coreVault: true,
      semanticSearch: true,
      apiAccess: true,
      cliTool: true,
      conflictDetection: true,
      memoryHealth: true,
      bulkExport: true,
      organizations: false,
      teams: false,
      sharedVault: false,
      auditLogs: false,
      usageAnalytics: false,
      customProjectKeys: false,
      crossWorkspaceSearch: false,
      knowledgeGraph: false,
      priorityAI: false,
      advancedSecurityControls: false,
      byokEncryption: false,
      enterpriseSSO: false,
      dedicatedSupport: false,
    },
  },
  business: {
    id: "business",
    label: "Business",
    price: "$12",
    priceNote: "per seat / month",
    available: true,
    limits: {
      maxMemories: 10000,
      maxMonthlyRecalls: 50000,
      maxMonthlyCommits: 10000,
      maxMonthlyTokens: 1000000,
      maxApiTokens: 50,
      maxOrgMembers: 50,
      maxTeams: 20,
      maxTeamMembers: 50,
    },
    features: {
      coreVault: true,
      semanticSearch: true,
      apiAccess: true,
      cliTool: true,
      conflictDetection: true,
      memoryHealth: true,
      bulkExport: true,
      organizations: true,
      teams: true,
      sharedVault: true,
      auditLogs: true,
      usageAnalytics: true,
      customProjectKeys: true,
      crossWorkspaceSearch: true,
      knowledgeGraph: true,
      priorityAI: false,
      advancedSecurityControls: true,
      byokEncryption: true,
      enterpriseSSO: false,
      dedicatedSupport: false,
    },
  },
  business_comp: {
    id: "business_comp",
    label: "Business (Comp)",
    price: "Complimentary",
    priceNote: "Admin granted",
    available: false,
    limits: {
      maxMemories: 10000,
      maxMonthlyRecalls: 50000,
      maxMonthlyCommits: 10000,
      maxMonthlyTokens: 1000000,
      maxApiTokens: 50,
      maxOrgMembers: 50,
      maxTeams: 20,
      maxTeamMembers: 50,
    },
    features: {
      coreVault: true,
      semanticSearch: true,
      apiAccess: true,
      cliTool: true,
      conflictDetection: true,
      memoryHealth: true,
      bulkExport: true,
      organizations: true,
      teams: true,
      sharedVault: true,
      auditLogs: true,
      usageAnalytics: true,
      customProjectKeys: true,
      crossWorkspaceSearch: true,
      knowledgeGraph: true,
      priorityAI: false,
      advancedSecurityControls: true,
      byokEncryption: true,
      enterpriseSSO: false,
      dedicatedSupport: false,
    },
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    price: "Custom",
    priceNote: "Contact us",
    available: true,
    limits: {
      maxMemories: Infinity,
      maxMonthlyRecalls: Infinity,
      maxMonthlyCommits: Infinity,
      maxMonthlyTokens: Infinity,
      maxApiTokens: Infinity,
      maxOrgMembers: Infinity,
      maxTeams: Infinity,
      maxTeamMembers: Infinity,
    },
    features: {
      coreVault: true,
      semanticSearch: true,
      apiAccess: true,
      cliTool: true,
      conflictDetection: true,
      memoryHealth: true,
      bulkExport: true,
      organizations: true,
      teams: true,
      sharedVault: true,
      auditLogs: true,
      usageAnalytics: true,
      customProjectKeys: true,
      crossWorkspaceSearch: true,
      knowledgeGraph: true,
      priorityAI: true,
      advancedSecurityControls: true,
      byokEncryption: true,
      enterpriseSSO: true,
      dedicatedSupport: true,
    },
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "business", "business_comp", "enterprise"];

/** Plans shown in self-serve billing/pricing UIs — excludes admin-only comp tier. */
export const SELF_SERVE_PLAN_ORDER: PlanId[] = ["free", "business", "enterprise"];

export function planAtLeast(planA: PlanId, planB: PlanId): boolean {
  return PLAN_ORDER.indexOf(planA) >= PLAN_ORDER.indexOf(planB);
}

export function planHasFeature(planId: PlanId, feature: keyof PlanFeatures): boolean {
  return PLANS[planId].features[feature];
}

export function getPlanLimits(planId: PlanId): PlanLimits {
  return PLANS[planId].limits;
}

export function resolvePlan(raw: string | null | undefined): PlanId {
  if (raw === "business" || raw === "business_comp" || raw === "enterprise") return raw;
  return "free";
}

/** Returns true if the plan has business-level features (paid or comp). */
export function isBusinessOrAbove(planId: PlanId): boolean {
  return planId === "business" || planId === "business_comp" || planId === "enterprise";
}

/** Returns true if the plan is billed via Stripe (not comp/free). */
export function isStripeBilled(planId: PlanId): boolean {
  return planId === "business" || planId === "enterprise";
}

export const FEATURE_DESCRIPTIONS: Record<keyof PlanFeatures, { label: string; description: string }> = {
  coreVault: {
    label: "Personal Memory Vault",
    description: "500 encrypted memories with semantic search and AI recall",
  },
  semanticSearch: {
    label: "Semantic Search",
    description: "AI-powered search with natural language understanding",
  },
  apiAccess: {
    label: "MCP API Access",
    description: "Integrate memories with your CLI tools and AI agents",
  },
  cliTool: {
    label: "CLI Tool",
    description: "Command-line interface for managing memories and workspaces",
  },
  conflictDetection: {
    label: "Conflict Detection",
    description: "Automatic detection and resolution of memory conflicts",
  },
  memoryHealth: {
    label: "Memory Health Dashboard",
    description: "Monitor memory freshness, staleness, and consistency metrics",
  },
  bulkExport: {
    label: "Bulk Export",
    description: "Export all memories with cryptographic audit trail",
  },
  organizations: {
    label: "Organizations",
    description: "Create and manage organizations with role-based access control",
  },
  teams: {
    label: "Teams",
    description: "Create sub-teams within your organization with scoped vaults",
  },
  sharedVault: {
    label: "Shared Vaults",
    description: "Share memory context across your organization or team",
  },
  auditLogs: {
    label: "Audit Logs",
    description: "Full audit trail of all memory operations",
  },
  usageAnalytics: {
    label: "Usage Analytics",
    description: "Track API token usage, recall counts, and commit trends",
  },
  customProjectKeys: {
    label: "Project Workspaces",
    description: "Scoped memory vaults per project or repository",
  },
  crossWorkspaceSearch: {
    label: "Cross-Workspace Search",
    description: "Search memories across all your workspaces simultaneously",
  },
  knowledgeGraph: {
    label: "Knowledge Graph",
    description: "Interactive visualization of memory entity relationships",
  },
  priorityAI: {
    label: "Priority AI Processing",
    description: "Priority queue for AI embedding and classification",
  },
  advancedSecurityControls: {
    label: "Advanced Security Controls",
    description: "IP whitelisting, session management, and security policies",
  },
  byokEncryption: {
    label: "Bring Your Own Key (BYOK)",
    description: "Client-side end-to-end encryption with your own encryption keys",
  },
  enterpriseSSO: {
    label: "Enterprise SSO",
    description: "SAML 2.0 and OIDC single sign-on for centralized identity management",
  },
  dedicatedSupport: {
    label: "Dedicated Support",
    description: "Priority support with dedicated account management",
  },
};
