/** Google Identity Services loader + button. ID-token flow only
 *  (credential callback) — no OAuth code flow, no client secret. */

const GIS_SRC = "https://accounts.google.com/gsi/client";

type CredentialResponse = { credential: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(cfg: {
            client_id: string;
            callback: (resp: CredentialResponse) => void;
          }): void;
          renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
          disableAutoSelect(): void;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Sign-In"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** Render the official Google button into `parent`; resolves the callback
 *  with a Google ID token on each successful sign-in. */
export async function renderGoogleButton(
  parent: HTMLElement,
  clientId: string,
  onIdToken: (idToken: string) => void
): Promise<void> {
  await loadScript();
  const id = window.google?.accounts.id;
  if (!id) throw new Error("Google Sign-In unavailable");
  id.initialize({ client_id: clientId, callback: (resp) => onIdToken(resp.credential) });
  id.renderButton(parent, { theme: "filled_black", size: "large", shape: "pill" });
}

/** Best-effort: stop GIS from auto-selecting this account next visit. */
export function googleSignOut(): void {
  window.google?.accounts.id.disableAutoSelect();
}
