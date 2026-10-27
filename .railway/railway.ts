import { defineRailway, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const vanityVolume = volume("vanity-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "iad", sizeMB: 50000 });
  const vanity = service("vanity", {
    source: { repo: "OutsolOnline/outsol", branch: "main" },
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { "iad": 1 },
    volumeMounts: { "/data": vanityVolume },
    env: { APP_ALLOWED_ORIGINS: preserve(), ASSET_STORAGE_DIR: preserve(), NODE_ENV: preserve(), PORT: preserve(), PUBLIC_APP_URL: preserve(), RPC_URL: preserve(), X_CLIENT_ID: preserve(), X_CLIENT_SECRET: preserve(), X_CALLBACK_URL: preserve(), X_TOKEN_ENCRYPTION_KEY: preserve(), X_STORAGE_DIR: preserve() },
  });

  return project("vanity", {
    resources: [vanity, vanityVolume],
  });
});
