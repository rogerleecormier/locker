import { createServerFn } from "@tanstack/react-start";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv } };

export const getDemoCredentials = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<{ email: string | null; password: string | null }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    return {
      email: env.DEMO_EMAIL ?? null,
      password: env.DEMO_PASSWORD ?? null,
    };
  },
);
