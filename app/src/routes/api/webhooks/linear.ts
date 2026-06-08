import type { CloudflareEnv } from "~/types/cloudflare";
import { handleWebhookRequest } from "~/server/webhooks";

export default {
  POST: async (request: Request, { env }: { env: CloudflareEnv }) => {
    return handleWebhookRequest(request, env, "linear");
  },
};
