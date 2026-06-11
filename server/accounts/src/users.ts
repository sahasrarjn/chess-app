import { randomUUID } from "node:crypto";
import type { IdpIdentity } from "./idtoken";
import { validateDisplayName } from "./protocol";
import type { UserRecord, UserStore } from "./store";

/** Resolve an authenticated provider identity to a user record:
 *  1. existing IDP mapping → that user;
 *  2. verified email matches an existing user → link this provider;
 *  3. otherwise create a new user.
 *  `nameHint` comes from the login body (Apple sends the name only
 *  client-side, on first authorization). The hint is validated via
 *  validateDisplayName before use — invalid hints fall back to "Player". */
export async function resolveUser(
  store: UserStore,
  identity: IdpIdentity,
  nameHint: string | undefined,
  now: Date
): Promise<UserRecord> {
  // Always work with lowercased email to ensure consistent lookups.
  const email = identity.email ? identity.email.toLowerCase() : null;

  const byIdp = await store.getUserIdByIdp(identity.provider, identity.sub);
  if (byIdp) {
    const user = await store.getUser(byIdp);
    if (user) return user;
    // Mapping without a profile (partial delete): fall through and recreate.
  }

  if (email) {
    const byEmail = await store.getUserIdByEmail(email);
    if (byEmail) {
      const user = await store.getUser(byEmail);
      if (user) {
        await store.putIdpMapping(identity.provider, identity.sub, user.userId);
        return user;
      }
    }
  }

  // Validate nameHint before use — never persist arbitrary hint verbatim.
  const validatedHint = nameHint !== undefined ? validateDisplayName(nameHint) ?? undefined : undefined;

  const user: UserRecord = {
    userId: randomUUID(),
    email: email ?? "",
    displayName: identity.name ?? validatedHint ?? "Player",
    avatarUrl: identity.avatarUrl,
    createdAt: now.toISOString(),
    stats: {},
  };
  await store.putUser(user);
  await store.putIdpMapping(identity.provider, identity.sub, user.userId);
  if (email) {
    await store.putEmailMapping(email, user.userId);
  }
  return user;
}
