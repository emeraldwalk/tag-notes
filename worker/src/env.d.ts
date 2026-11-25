// Worker secrets, which `wrangler types` can't see. Set with `npx wrangler secret put <NAME>` from worker/.
interface WorkerSecrets {
  IDP_CLIENT_ID: string;
  IDP_CLIENT_SECRET: string;
  COOKIE_SECRET: string;
  // Plan 14: the LibreLinkUp follower account. Without them the cron does nothing (the Home Assistant fallback).
  LLU_EMAIL?: string;
  LLU_PASSWORD?: string;
  // Plan 14: Home Assistant's bearer token for POST /api/ingest/glucose. Not family-mail's token of the same name.
  HA_INGEST_TOKEN?: string;
}

interface Env extends WorkerSecrets {}

declare namespace Cloudflare {
  interface Env extends WorkerSecrets {}
}
