import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // The AI binding (plan 10) is remote-only; tests use a fake provider and never reach Cloudflare.
      remoteBindings: false,
      miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations('migrations') } },
    }),
  ],
  test: { include: ['test/*.test.ts'], setupFiles: ['test/apply-migrations.ts'] },
}));
