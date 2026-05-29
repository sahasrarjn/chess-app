import posthog from "posthog-js";

export function initAnalytics(): void {
  posthog.init("phc_jNQrieLS33lPoBEzS3LX8m78DEXJDbehagm1rHC9fSo", {
    api_host: "https://us.i.posthog.com",
    defaults: "2025-11-30",
    person_profiles: "identified_only",
  });
}
