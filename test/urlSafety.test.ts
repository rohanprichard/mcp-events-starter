import assert from "node:assert/strict";
import test from "node:test";
import { checkedDestination, isPublicAddress } from "../src/urlSafety.js";

test("rejects local and private callback addresses", async () => {
  assert.equal(isPublicAddress("10.0.0.1"), false);
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("169.254.169.254"), false);
  assert.equal(isPublicAddress("::1"), false);
  await assert.rejects(checkedDestination("http://example.com/hook", false, async () => ["8.8.8.8"]));
  await assert.rejects(checkedDestination("https://example.com/hook", false, async () => ["8.8.8.8", "10.0.0.1"]));
  await assert.rejects(checkedDestination("https://127.0.0.1/hook", false));
  await assert.rejects(checkedDestination("https://[::1]/hook", false));
});

test("allows only loopback HTTP in demo mode", async () => {
  const target = await checkedDestination("http://localhost:4000/hook", true, async () => ["127.0.0.1"]);
  assert.equal(target.localDemo, true);
  await assert.rejects(checkedDestination("http://localhost:4000/hook", true, async () => ["10.0.0.1"]));
  await assert.rejects(checkedDestination("http://example.com/hook", true, async () => ["8.8.8.8"]));
});
