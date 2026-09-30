import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { sameChallenge, sign, signingKey } from "../src/signatures.js";

test("signs the exact body bytes", () => {
  const key = Buffer.alloc(32, 7);
  const secret = `whsec_${key.toString("base64")}`;
  const body = '{"text":"é"}';
  const expected = createHmac("sha256", key).update(`evt_1.123.${body}`).digest("base64");
  assert.equal(sign(secret, "evt_1", 123, body), `v1,${expected}`);
  assert.notEqual(sign(secret, "evt_1", 123, '{"text":"e"}'), `v1,${expected}`);
});

test("checks the key length and challenge", () => {
  assert.throws(() => signingKey("whsec_bad"));
  assert.throws(() => signingKey(`whsec_${Buffer.alloc(23).toString("base64")}`));
  assert.equal(sameChallenge("abc", "abc"), true);
  assert.equal(sameChallenge("abc", "abd"), false);
});
