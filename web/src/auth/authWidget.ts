import { ACCOUNTS_API_URL, APPLE_CLIENT_ID, GOOGLE_CLIENT_ID, isAuthConfigured } from "./config";
import { AuthApiError, getMe, login } from "./api";
import { clearSession, getCachedProfile, getSessionToken, saveSession } from "./session";
import { googleSignOut, renderGoogleButton } from "./googleSignIn";
import { clearPendingUploads } from "../game/gameUploads";

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Factory — returns null when auth is not configured so caller can skip mounting. */
export function createAuthWidget(): HTMLElement | null {
  if (!isAuthConfigured) return null;

  const container = el("div", "home-auth");
  let cleanupMenuListener: (() => void) | null = null;
  render();
  return container;

  function render(): void {
    if (cleanupMenuListener) {
      cleanupMenuListener();
      cleanupMenuListener = null;
    }
    container.innerHTML = "";

    const profile = getCachedProfile();
    const token = getSessionToken();

    if (profile && token) {
      renderSignedIn(profile, token);
    } else {
      renderSignedOut();
    }
  }

  function renderSignedIn(
    profile: { userId: string; email: string; displayName: string; avatarUrl: string | null },
    token: string
  ): void {
    // Fire-and-forget refresh
    getMe(ACCOUNTS_API_URL!, token).then(
      (fresh) => {
        saveSession(token, fresh);
        // Only re-render if name/avatar changed
        if (
          fresh.displayName !== getCachedProfile()?.displayName ||
          fresh.avatarUrl !== getCachedProfile()?.avatarUrl
        ) {
          render();
        }
      },
      (err: unknown) => {
        if (err instanceof AuthApiError && err.status === 401) {
          clearSession();
          render();
        }
        // Other errors: degrade silently, keep showing cached profile
      }
    );

    const trigger = el("button", "home-auth-trigger");
    trigger.setAttribute("aria-label", "Account menu");

    if (profile.avatarUrl) {
      const img = document.createElement("img");
      img.className = "home-auth-avatar";
      img.src = profile.avatarUrl;
      img.alt = profile.displayName;
      trigger.appendChild(img);
    } else {
      const disc = el("span", "home-auth-avatar home-auth-avatar--initials");
      disc.textContent = (profile.displayName || profile.email || "?")[0].toUpperCase();
      trigger.appendChild(disc);
    }

    const nameSpan = el("span", "home-auth-name");
    nameSpan.textContent = profile.displayName || profile.email;
    trigger.appendChild(nameSpan);

    let menuOpen = false;
    const menu = el("div", "home-auth-menu");
    menu.hidden = true;

    const emailItem = el("p", "home-auth-menu-email");
    emailItem.textContent = profile.email;
    menu.appendChild(emailItem);

    const signOutBtn = el("button", "home-auth-signout", "Sign out");
    signOutBtn.onclick = () => {
      clearSession();
      clearPendingUploads();
      googleSignOut();
      render();
    };
    menu.appendChild(signOutBtn);

    // Close menu on outside click
    const onDocClick = (e: MouseEvent) => {
      if (!container.contains(e.target as Node)) {
        menuOpen = false;
        menu.hidden = true;
        document.removeEventListener("click", onDocClick);
        cleanupMenuListener = null;
      }
    };

    trigger.onclick = () => {
      menuOpen = !menuOpen;
      menu.hidden = !menuOpen;
      if (menuOpen) {
        document.addEventListener("click", onDocClick);
        cleanupMenuListener = () => document.removeEventListener("click", onDocClick);
      } else {
        document.removeEventListener("click", onDocClick);
        cleanupMenuListener = null;
      }
    };

    container.appendChild(trigger);
    container.appendChild(menu);
  }

  function renderSignedOut(): void {
    const signInBtn = el("button", "home-auth-signin", "Sign in");
    let popoverOpen = false;

    const popover = el("div", "home-auth-popover");
    popover.hidden = true;

    const gisContainer = el("div", "home-auth-gis-container");
    popover.appendChild(gisContainer);

    if (APPLE_CLIENT_ID) {
      const appleBtn = document.createElement("button");
      appleBtn.className = "home-auth-apple";
      appleBtn.textContent = "Sign in with Apple";
      appleBtn.disabled = true;
      appleBtn.title = "Apple Sign-In coming soon";
      popover.appendChild(appleBtn);
    }

    const errorEl = el("p", "home-auth-error");
    errorEl.hidden = true;
    popover.appendChild(errorEl);

    signInBtn.onclick = async () => {
      if (popoverOpen) {
        popoverOpen = false;
        popover.hidden = true;
        return;
      }
      popoverOpen = true;
      popover.hidden = false;
      errorEl.hidden = true;

      try {
        gisContainer.innerHTML = "";
        await renderGoogleButton(gisContainer, GOOGLE_CLIENT_ID!, async (idToken) => {
          errorEl.hidden = true;
          try {
            const result = await login(ACCOUNTS_API_URL!, "google", idToken);
            saveSession(result.token, result.profile);
            render();
          } catch {
            errorEl.textContent = "Sign-in failed — you can keep playing as a guest.";
            errorEl.hidden = false;
          }
        });
      } catch {
        errorEl.textContent = "Sign-in failed — you can keep playing as a guest.";
        errorEl.hidden = false;
      }
    };

    container.appendChild(signInBtn);
    container.appendChild(popover);
  }
}
