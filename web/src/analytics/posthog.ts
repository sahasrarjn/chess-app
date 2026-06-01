export async function initAnalytics(): Promise<void> {
  try {
    const { default: posthog } = await import("posthog-js");
    posthog.init("phc_jNQrieLS33lPoBEzS3LX8m78DEXJDbehagm1rHC9fSo", {
      api_host: "https://us.i.posthog.com",
      defaults: "2025-11-30",
      person_profiles: "identified_only",
    });
  } catch {
    // Analytics must never block the game from loading.
  }
}
