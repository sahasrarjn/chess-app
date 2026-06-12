import { ACCOUNTS_API_URL, GOOGLE_CLIENT_ID, isAuthConfigured } from "../auth/config";
import { login } from "../auth/api";
import { saveSession } from "../auth/session";
import { renderGoogleButton } from "../auth/googleSignIn";

const LOGO_SRC =
  (import.meta.env.VITE_LOGO_CDN_URL as string | undefined) ??
  (import.meta.env.DEV
    ? `${import.meta.env.BASE_URL}logo_v2.png`
    : "/logo_v2.png");

const GUEST_KEY = "chessborder.guestSession";

export function hasChosenGuestThisSession(): boolean {
  try {
    return sessionStorage.getItem(GUEST_KEY) === "1";
  } catch {
    return false;
  }
}

function setGuestSession(): void {
  try {
    sessionStorage.setItem(GUEST_KEY, "1");
  } catch { /* ignore */ }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderSignIn(
  root: HTMLElement,
  onSignedIn: () => void,
  onGuest: () => void
): () => void {
  root.innerHTML = "";
  const screen = el("div", "signin-screen");

  const logo = document.createElement("img");
  logo.className = "home-logo signin-logo";
  logo.src = LOGO_SRC;
  logo.alt = "Border Chess";
  logo.width = 96;
  logo.height = 96;
  screen.appendChild(logo);

  screen.appendChild(el("h1", "", "Border Chess"));
  screen.appendChild(el("p", "signin-tagline", "10×10 border chess"));

  const card = el("div", "signin-card");

  card.appendChild(el("p", "signin-prompt", "Sign in to track your games, appear on the leaderboard, and replay your history."));

  if (isAuthConfigured && GOOGLE_CLIENT_ID && ACCOUNTS_API_URL) {
    const gisWrap = el("div", "signin-gis-wrap");
    // Render the GIS button lazily after a tick so the container is in the DOM
    setTimeout(() => {
      renderGoogleButton(gisWrap, GOOGLE_CLIENT_ID!, async (idToken) => {
        try {
          const { token, profile } = await login(ACCOUNTS_API_URL!, "google", idToken);
          saveSession(token, profile);
          onSignedIn();
        } catch {
          // Silent fallback — show error inline
          const err = el("p", "signin-error", "Sign-in failed. Try again or continue as guest.");
          card.appendChild(err);
        }
      });
    }, 0);
    card.appendChild(gisWrap);
  }

  const sep = el("div", "signin-sep");
  sep.appendChild(el("span", "signin-sep-line"));
  sep.appendChild(el("span", "signin-sep-text", "or"));
  sep.appendChild(el("span", "signin-sep-line"));
  card.appendChild(sep);

  const guestBtn = el("button", "primary signin-guest", "Continue as Guest") as HTMLButtonElement;
  guestBtn.onclick = () => {
    setGuestSession();
    onGuest();
  };
  card.appendChild(guestBtn);

  screen.appendChild(card);
  root.appendChild(screen);

  return () => { root.innerHTML = ""; };
}
