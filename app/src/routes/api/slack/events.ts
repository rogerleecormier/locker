import type { CloudflareEnv } from "~/types/cloudflare";
import { handleSlackWebhookRequest } from "~/server/slack/webhook";

export default {
  POST: async (request: Request, { env }: { env: CloudflareEnv }) => {
    return handleSlackWebhookRequest(request, env);
  },
};
