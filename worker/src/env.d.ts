// Worker secrets, which `wrangler types` can't see. Set with `npx wrangler secret put <NAME>` from worker/.
interface WorkerSecrets {
  IDP_CLIENT_ID: string;
  IDP_CLIENT_SECRET: string;
  COOKIE_SECRET: string;
}

interface Env extends WorkerSecrets {}

declare namespace Cloudflare {
  interface Env extends WorkerSecrets {}
}
