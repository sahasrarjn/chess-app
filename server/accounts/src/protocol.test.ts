import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseLoginRequest,
  parseUpdateMeRequest,
  validateDisplayName,
} from "./protocol.ts";

describe("parseLoginRequest", () => {
  it("accepts a valid google request", () => {
    const result = parseLoginRequest(JSON.stringify({ provider: "google", idToken: "tok123" }));
    assert.deepEqual(result, { provider: "google", idToken: "tok123" });
  });

  it("accepts a valid apple request", () => {
    const result = parseLoginRequest(JSON.stringify({ provider: "apple", idToken: "tok456" }));
    assert.deepEqual(result, { provider: "apple", idToken: "tok456" });
  });

  it("includes optional name when present and non-empty", () => {
    const result = parseLoginRequest(
      JSON.stringify({ provider: "google", idToken: "tok", name: "Alice" })
    );
    assert.equal(result?.name, "Alice");
  });

  it("omits name when empty or whitespace-only", () => {
    const result = parseLoginRequest(
      JSON.stringify({ provider: "google", idToken: "tok", name: "   " })
    );
    assert.equal(result?.name, undefined);
  });

  it("rejects unknown provider", () => {
    assert.equal(
      parseLoginRequest(JSON.stringify({ provider: "facebook", idToken: "tok" })),
      null
    );
  });

  it("rejects missing idToken", () => {
    assert.equal(parseLoginRequest(JSON.stringify({ provider: "google" })), null);
  });

  it("rejects empty idToken", () => {
    assert.equal(
      parseLoginRequest(JSON.stringify({ provider: "google", idToken: "" })),
      null
    );
  });

  it("rejects oversized idToken", () => {
    const big = "x".repeat(4097);
    assert.equal(
      parseLoginRequest(JSON.stringify({ provider: "google", idToken: big })),
      null
    );
  });

  it("rejects non-JSON input", () => {
    assert.equal(parseLoginRequest("not-json"), null);
  });

  it("rejects null input", () => {
    assert.equal(parseLoginRequest(null), null);
  });

  it("rejects empty string input", () => {
    assert.equal(parseLoginRequest(""), null);
  });

  it('rejects JSON array "[]"', () => {
    assert.equal(parseLoginRequest("[]"), null);
  });

  it('rejects JSON string "\\"x\\""', () => {
    assert.equal(parseLoginRequest('"x"'), null);
  });

  it('rejects JSON null "null"', () => {
    assert.equal(parseLoginRequest("null"), null);
  });

  it("treats name hint of 201 chars as absent (name is null/undefined)", () => {
    const longName = "a".repeat(201);
    const result = parseLoginRequest(
      JSON.stringify({ provider: "google", idToken: "tok", name: longName })
    );
    // Request should still parse successfully (valid provider and idToken)
    assert.ok(result !== null, "request itself should be valid");
    assert.equal(result?.name, undefined);
  });
});

describe("parseUpdateMeRequest", () => {
  it("accepts a valid displayName", () => {
    const result = parseUpdateMeRequest(JSON.stringify({ displayName: "Alice" }));
    assert.deepEqual(result, { displayName: "Alice" });
  });

  it("rejects missing displayName", () => {
    assert.equal(parseUpdateMeRequest(JSON.stringify({ foo: "bar" })), null);
  });

  it("rejects non-string displayName", () => {
    assert.equal(parseUpdateMeRequest(JSON.stringify({ displayName: 42 })), null);
  });

  it("rejects null input", () => {
    assert.equal(parseUpdateMeRequest(null), null);
  });
});

describe("parseObject 8192-byte guard", () => {
  it("rejects a body larger than 8192 bytes", () => {
    // Craft a JSON string whose length is just over 8192 bytes.
    const prefix = '{"displayName":"';
    const suffix = '"}';
    const padding = "x".repeat(8192 - prefix.length - suffix.length + 1);
    const big = prefix + padding + suffix;
    assert.ok(big.length > 8192, `sanity: body length is ${big.length}`);
    assert.equal(parseUpdateMeRequest(big), null);
  });

  it("accepts a body at exactly 8192 bytes", () => {
    const prefix = '{"displayName":"';
    const suffix = '"}';
    const padding = "x".repeat(8192 - prefix.length - suffix.length);
    const exact = prefix + padding + suffix;
    assert.equal(exact.length, 8192, `sanity: body length is ${exact.length}`);
    // The displayName value is far over 30 chars so validateDisplayName rejects it,
    // but parseUpdateMeRequest should still return a non-null object (size gate passes).
    const result = parseUpdateMeRequest(exact);
    assert.ok(result !== null, "parseUpdateMeRequest should parse a body at exactly 8192 bytes");
  });
});

describe("validateDisplayName", () => {
  it("accepts a simple name", () => {
    assert.equal(validateDisplayName("Alice"), "Alice");
  });

  it("trims leading/trailing whitespace", () => {
    assert.equal(validateDisplayName("  Alice  "), "Alice");
  });

  it("collapses internal whitespace", () => {
    assert.equal(validateDisplayName("Alice   Bob"), "Alice Bob");
  });

  it("accepts a 30-character name", () => {
    const name = "a".repeat(30);
    assert.equal(validateDisplayName(name), name);
  });

  it("rejects a 31-character name", () => {
    assert.equal(validateDisplayName("a".repeat(31)), null);
  });

  it("rejects empty string", () => {
    assert.equal(validateDisplayName(""), null);
  });

  it("rejects whitespace-only string", () => {
    assert.equal(validateDisplayName("   "), null);
  });

  it("rejects a name that trims to empty", () => {
    assert.equal(validateDisplayName("  "), null);
  });
});
