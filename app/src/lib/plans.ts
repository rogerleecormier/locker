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
  organizations: boolean;
  teams: boolean;
  sharedVault: boolean;
  auditLogs: boolean;
  usageAnalytics: boolean;
  bulkExport: boolean;
  priorityAI: boolean;
  customProjectKeys: boolean;
  crossWorkspaceSearch: boolean;
  knowledgeGraph: boolean;
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
      organizations: false,
      teams: false,
      sharedVault: false,
      auditLogs: false,
      usageAnalytics: false,
      bulkExport: true,
      priorityAI: false,
      customProjectKeys: false,
      crossWorkspaceSearch: false,
      knowledgeGraph: false,
    },
  },
  business: {
    id: "business",
    label: "Business",
    price: "$12",
    priceNote: "per seat / month",
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
      organizations: true,
      teams: true,
      sharedVault: true,
      auditLogs: true,
      usageAnalytics: true,
      bulkExport: true,
      priorityAI: false,
      customProjectKeys: true,
      crossWorkspaceSearch: true,
      knowledgeGraph: true,
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
      organizations: true,
      teams: true,
      sharedVault: true,
      auditLogs: true,
      usageAnalytics: true,
      bulkExport: true,
      priorityAI: false,
      customProjectKeys: true,
      crossWorkspaceSearch: true,
      knowledgeGraph: true,
    },
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    price: "Custom",
    priceNote: "Contact us",
    available: false,
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
      organizations: true,
      teams: true,
      sharedVault: true,
      auditLogs: true,
      usageAnalytics: true,
      bulkExport: true,
      priorityAI: true,
      customProjectKeys: true,
      crossWorkspaceSearch: true,
      knowledgeGraph: true,
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
  bulkExport: {
    label: "Bulk Export",
    description: "Export all memories with cryptographic audit trail",
  },
  priorityAI: {
    label: "Priority AI Processing",
    description: "Priority queue for AI embedding and classification",
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
};
