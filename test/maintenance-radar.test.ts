import assert from "node:assert/strict";
import test from "node:test";
import { needsAttention } from "../src/maintenance-radar.js";

test("flags a property workflow when its inspection queue has a dead letter", () => {
  const result = needsAttention({
    runs: { items: [{ status: "completed" }] },
    deadLetters: { items: [{ message_id: "inspection-42" }] },
    capturedErrors: { groups: [] },
  });
  assert.equal(result, true);
});

test("leaves a clean inspection workflow alone", () => {
  const result = needsAttention({
    runs: { items: [{ status: "completed" }] },
    deadLetters: { items: [] },
    capturedErrors: { groups: [] },
  });
  assert.equal(result, false);
});
