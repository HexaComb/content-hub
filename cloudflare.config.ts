import { bindings, defineConfig } from "cf/config";

// Local build/dev configuration. No cloud resources are created by npm run build.
// Review account, D1 binding and authorization setup before any deployment.
export default defineConfig({
  worker: {
    name: "content-hub",
    entrypoint: "./src/index.ts",
    compatibilityDate: "2026-11-10",
    env: {
      DB: bindings.d1({ name: "content-hub" }),
      REQUEST_LIMITER: bindings.rateLimit({ namespace: "1001", simple: { limit: 120, period: 60 } }),
    },
    observability: {
      enabled: true, redactQueryString: true,
      logs: { enabled: true, headSamplingRate: 0.1 },
      traces: { enabled: true, headSamplingRate: 0.1 },
    },
  },
});
