/** Accounts API base URL, e.g. https://xxxx.execute-api.us-east-1.amazonaws.com */
export const ACCOUNTS_API_URL =
  (import.meta.env.VITE_ACCOUNTS_API_URL as string | undefined)?.replace(/\/$/, "");

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

/** Apple web sign-in is stubbed until the Services ID exists in the Apple console. */
export const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID as string | undefined;

/** Sign-in UI renders only when the API and at least Google are configured. */
export const isAuthConfigured = Boolean(ACCOUNTS_API_URL && GOOGLE_CLIENT_ID);
