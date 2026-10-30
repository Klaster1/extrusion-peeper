import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dropIndex } from "./reorder.js";

describe("dropIndex", () => {
  const boxes = [
    { top: 0, height: 100 },
    { top: 100, height: 100 },
  ];

  it("drops before the first item whose middle is below the pointer", () => {
    assert.equal(dropIndex(boxes, 10), 0);
    assert.equal(dropIndex(boxes, 60), 1);
    assert.equal(dropIndex(boxes, 140), 1);
  });

  it("drops last below the middle of the last item", () => {
    assert.equal(dropIndex(boxes, 160), 2);
    assert.equal(dropIndex([], 0), 0);
  });
});
