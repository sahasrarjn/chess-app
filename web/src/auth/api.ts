export interface Profile {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

type FetchLike = typeof fetch;

export async function checkResponse(res: Response): Promise<Response> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore parse error — use statusText
    }
    throw new AuthApiError(res.status, message);
  }
  return res;
}

export async function login(
  baseUrl: string,
  provider: "google" | "apple",
  idToken: string,
  name?: string,
  fetchImpl: FetchLike = fetch
): Promise<{ token: string; profile: Profile }> {
  const body: Record<string, string> = { provider, idToken };
  if (name !== undefined) body.name = name;

  const res = await fetchImpl(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await checkResponse(res);
  return res.json() as Promise<{ token: string; profile: Profile }>;
}

export async function getMe(
  baseUrl: string,
  token: string,
  fetchImpl: FetchLike = fetch
): Promise<Profile> {
  const res = await fetchImpl(`${baseUrl}/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await checkResponse(res);
  const data = (await res.json()) as { profile: Profile };
  return data.profile;
}

export async function updateMe(
  baseUrl: string,
  token: string,
  displayName: string,
  fetchImpl: FetchLike = fetch
): Promise<Profile> {
  const res = await fetchImpl(`${baseUrl}/v1/me`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ displayName }),
  });
  await checkResponse(res);
  const data = (await res.json()) as { profile: Profile };
  return data.profile;
}
