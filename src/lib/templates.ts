export type Template = {
  id: string;
  title: string;
  description: string;
  category: "productivity" | "coding" | "writing";
  items: Array<{
    fact: string;
    category: "rules" | "projects" | "references";
    tags: string;
  }>;
};

export const TEMPLATES: Template[] = [
  {
    id: "typescript-defaults",
    title: "TypeScript Defaults",
    description: "Best practices and conventions for TypeScript projects",
    category: "coding",
    items: [
      {
        fact: "Always use TypeScript strict mode with no implicit any.",
        category: "rules",
        tags: "typescript, best-practices",
      },
      {
        fact: "Prefer const over let, never use var.",
        category: "rules",
        tags: "typescript, style",
      },
      {
        fact: "Use interfaces for public APIs, type for internal data structures.",
        category: "rules",
        tags: "typescript, architecture",
      },
      {
        fact: "Enable noImplicitAny, noImplicitThis, and strictNullChecks in tsconfig.json.",
        category: "rules",
        tags: "typescript, configuration",
      },
      {
        fact: "Use async/await instead of .then() chains for promise handling.",
        category: "rules",
        tags: "typescript, async",
      },
    ],
  },
  {
    id: "code-review-checklist",
    title: "Code Review Checklist",
    description: "Guidelines for reviewing pull requests and code changes",
    category: "productivity",
    items: [
      {
        fact: "Check for security vulnerabilities: SQL injection, XSS, CSRF, insecure deserialization.",
        category: "rules",
        tags: "code-review, security",
      },
      {
        fact: "Verify test coverage: new code should have corresponding tests, critical paths must be covered.",
        category: "rules",
        tags: "code-review, testing",
      },
      {
        fact: "Review performance implications: check for N+1 queries, unnecessary loops, unbounded memory growth.",
        category: "rules",
        tags: "code-review, performance",
      },
      {
        fact: "Ensure code style is consistent with the project's guidelines and linting rules pass.",
        category: "rules",
        tags: "code-review, style",
      },
      {
        fact: "Verify error handling is appropriate: no swallowed exceptions, meaningful error messages.",
        category: "rules",
        tags: "code-review, error-handling",
      },
      {
        fact: "Check for backward compatibility concerns and migration paths if breaking changes exist.",
        category: "rules",
        tags: "code-review, compatibility",
      },
    ],
  },
  {
    id: "writing-style-guide",
    title: "Writing Style Guide",
    description: "Preferred tone, structure, and writing conventions",
    category: "writing",
    items: [
      {
        fact: "Prefer concise, direct language. Avoid filler words and unnecessary elaboration.",
        category: "rules",
        tags: "writing, style",
      },
      {
        fact: "Use active voice instead of passive voice whenever possible.",
        category: "rules",
        tags: "writing, grammar",
      },
      {
        fact: "Break long paragraphs into shorter ones for readability. Aim for 2-4 sentences per paragraph.",
        category: "rules",
        tags: "writing, formatting",
      },
      {
        fact: "Use specific examples rather than vague generalizations to support claims.",
        category: "rules",
        tags: "writing, clarity",
      },
      {
        fact: "Avoid marketing speak, jargon, and corporate clichés. Use plain language.",
        category: "rules",
        tags: "writing, tone",
      },
      {
        fact: "End responses with a summary of what changed and what's next—no trailing filler.",
        category: "rules",
        tags: "writing, documentation",
      },
    ],
  },
  {
    id: "meeting-notes",
    title: "Meeting Notes Framework",
    description: "Structure for capturing and organizing meeting information",
    category: "productivity",
    items: [
      {
        fact: "Always record meeting attendees, date, time, and duration at the top.",
        category: "rules",
        tags: "meetings, structure",
      },
      {
        fact: "Separate notes into: Agenda, Decisions Made, Action Items, and Open Questions.",
        category: "rules",
        tags: "meetings, organization",
      },
      {
        fact: "Action items must include: owner, description, due date, and priority level.",
        category: "rules",
        tags: "meetings, action-items",
      },
      {
        fact: "Decisions should be documented with the reasoning behind them, not just the outcome.",
        category: "rules",
        tags: "meetings, decisions",
      },
      {
        fact: "Highlight risks and blockers that emerged during discussion.",
        category: "rules",
        tags: "meetings, risks",
      },
    ],
  },
];
