import { bindings, defineConfig } from "cf/config";

// Local build/dev configuration. No cloud resources are created by npm run build.
// Review account, D1 binding and authorization setup before any deployment.
export default defineConfig({
  worker: {
    name: "content-hub",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-11-10",
    assets: { runWorkerFirst: true, notFoundHandling: "none" },
    env: {
      DB: bindings.d1({ name: "content-hub", id: "0c416a53-1eef-415b-9e81-db37f818922e" }),
      ASSETS: bindings.assets(),
      APP_ORIGIN: bindings.text("https://content-hub.marcode-chavez-jr.workers.dev"),
      INVITATIONS_ENABLED: bindings.text("false"),
      // Reference the already configured server secret; never store its value here.
      RESEND_API_KEY: bindings.secret(),
      RESEND_FROM: bindings.text("content-hub@unreelviews.com"),
      ADMIN_ACCESS_ENABLED: bindings.text("false"),
      CLERK_AUTH_ENABLED: bindings.text("false"),
      REQUEST_LIMITER: bindings.rateLimit({ namespace: "1001", simple: { limit: 120, period: 60 } }),
    },
    observability: {
      enabled: true, redactQueryString: true,
      logs: { enabled: true, headSamplingRate: 0.1 },
      traces: { enabled: true, headSamplingRate: 0.1 },
    },
  },
});
