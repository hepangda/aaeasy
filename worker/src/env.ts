export type WorkerEnv = Cloudflare.Env & {
  OIDC_CLIENT_SECRET?: string;
  OIDC_SESSION_SECRET?: string;
  PDF_LAUNCH_INTERVAL_MS?: string;
};
