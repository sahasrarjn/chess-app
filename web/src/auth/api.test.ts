import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthApiError, login, getMe, updateMe } from "./api";
import type { Profile } from "./api";

const BASE_URL = "https://api.example.com";

const sampleProfile: Profile = {
  userId: "user-abc",
  email: "user@example.com",
  displayName: "Test User",
  avatarUrl: "https://example.com/avatar.jpg",
  createdAt: "2024-01-01T00:00:00.000Z",
};

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

function makeFetch(
  status: number,
  responseBody: unknown
): { fetch: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url = input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(h)) {
        headers[k.toLowerCase()] = v;
      }
    }
    let parsedBody: unknown = undefined;
    if (init?.body) {
      try {
        parsedBody = JSON.parse(init.body as string);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method: init?.method ?? "GET", headers, body: parsedBody });

    const json = JSON.stringify(responseBody);
    return new Response(json, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

describe("login()", () => {
  it("POSTs provider and idToken to /v1/auth/login", async () => {
    const { fetch: fetchImpl, calls } = makeFetch(200, {
      token: "sess_tok",
      profile: sampleProfile,
    });
    const result = await login(BASE_URL, "google", "id_token_xyz", undefined, fetchImpl);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE_URL}/v1/auth/login`);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers["content-type"], "application/json");
    assert.deepEqual(calls[0].body, { provider: "google", idToken: "id_token_xyz" });
    assert.equal(result.token, "sess_tok");
    assert.equal(result.profile.userId, "user-abc");
  });

  it("includes optional name when provided", async () => {
    const { fetch: fetchImpl, calls } = makeFetch(200, {
      token: "sess_tok",
      profile: sampleProfile,
    });
    await login(BASE_URL, "google", "id_token_xyz", "Alice", fetchImpl);
    assert.deepEqual(calls[0].body, {
      provider: "google",
      idToken: "id_token_xyz",
      name: "Alice",
    });
  });

  it("works with apple provider", async () => {
    const { fetch: fetchImpl, calls } = makeFetch(200, {
      token: "sess_tok",
      profile: sampleProfile,
    });
    await login(BASE_URL, "apple", "apple_id_token", undefined, fetchImpl);
    assert.equal((calls[0].body as { provider: string }).provider, "apple");
  });

  it("throws AuthApiError on 401", async () => {
    const { fetch: fetchImpl } = makeFetch(401, { error: "Invalid token" });
    await assert.rejects(
      () => login(BASE_URL, "google", "bad_token", undefined, fetchImpl),
      (err: unknown) => {
        assert.ok(err instanceof AuthApiError);
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it("throws AuthApiError on 400", async () => {
    const { fetch: fetchImpl } = makeFetch(400, { error: "Invalid body" });
    await assert.rejects(
      () => login(BASE_URL, "google", "tok", undefined, fetchImpl),
      (err: unknown) => {
        assert.ok(err instanceof AuthApiError);
        assert.equal(err.status, 400);
        return true;
      }
    );
  });
});

describe("getMe()", () => {
  it("sends GET to /v1/me with Authorization Bearer header", async () => {
    const { fetch: fetchImpl, calls } = makeFetch(200, { profile: sampleProfile });
    const profile = await getMe(BASE_URL, "my_session_token", fetchImpl);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE_URL}/v1/me`);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].headers["authorization"], "Bearer my_session_token");
    assert.equal(profile.userId, "user-abc");
  });

  it("unwraps the {profile} envelope", async () => {
    const { fetch: fetchImpl } = makeFetch(200, { profile: sampleProfile });
    const profile = await getMe(BASE_URL, "tok", fetchImpl);
    assert.equal(profile.email, "user@example.com");
  });

  it("throws AuthApiError 401 on expired token", async () => {
    const { fetch: fetchImpl } = makeFetch(401, { error: "Unauthorized" });
    await assert.rejects(
      () => getMe(BASE_URL, "expired_tok", fetchImpl),
      (err: unknown) => {
        assert.ok(err instanceof AuthApiError);
        assert.equal(err.status, 401);
        return true;
      }
    );
  });
});

describe("updateMe()", () => {
  it("POSTs displayName to /v1/me with Authorization Bearer header", async () => {
    const { fetch: fetchImpl, calls } = makeFetch(200, { profile: sampleProfile });
    const profile = await updateMe(BASE_URL, "my_token", "New Name", fetchImpl);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE_URL}/v1/me`);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers["authorization"], "Bearer my_token");
    assert.equal(calls[0].headers["content-type"], "application/json");
    assert.deepEqual(calls[0].body, { displayName: "New Name" });
    assert.equal(profile.userId, "user-abc");
  });

  it("unwraps the {profile} envelope", async () => {
    const { fetch: fetchImpl } = makeFetch(200, { profile: sampleProfile });
    const profile = await updateMe(BASE_URL, "tok", "Name", fetchImpl);
    assert.equal(profile.displayName, "Test User");
  });

  it("throws AuthApiError on non-2xx", async () => {
    const { fetch: fetchImpl } = makeFetch(400, { error: "Display name too long" });
    await assert.rejects(
      () => updateMe(BASE_URL, "tok", "x".repeat(50), fetchImpl),
      (err: unknown) => {
        assert.ok(err instanceof AuthApiError);
        assert.equal(err.status, 400);
        return true;
      }
    );
  });
});
