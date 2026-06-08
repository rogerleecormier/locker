export type ComparisonStatus = "new" | "duplicate" | "update" | "contradiction";

export type ImportComparisonItem = {
  tempId: string;
  fact: string;
  category: "rules" | "projects" | "references";
  tags?: string;
  projectKey?: string;
  status: ComparisonStatus;
  matchedMemory?: {
    id: string;
    fact: string;
    category: "rules" | "projects" | "references";
    tags: string;
    projectKey?: string | null;
  };
  reason?: string;
};
