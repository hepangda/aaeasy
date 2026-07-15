export type WorkerEnv = Cloudflare.Env & {
  AI_API_URL?: string;
  AI_API_KEY?: string;
  AI_DEBUG_TIMING?: string;
  AI_ENABLE_IMAGE_CONTEXT?: string;
  AI_GATEWAY_TOKEN?: string;
  AI_MODEL?: string;
  AI_PROVIDER?: string;
  DASHSCOPE_API_KEY?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_SESSION_SECRET?: string;
  PDF_LAUNCH_INTERVAL_MS?: string;
};
