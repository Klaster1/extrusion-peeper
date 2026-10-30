import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./fakes.js";

/** @type {typeof import("./readouts.js").showReadouts} */
let showReadouts;
let container;
let template;

before(async () => {
  await loadPage();
  ({ showReadouts } = await import("./readouts.js"));
  container = document.querySelector(".readouts");
  template = document.querySelector("#template-readout");
});

const reading = {
  display: "humidity",
  label: "AMS",
  icon: "ams",
  value: 14,
  online: true,
  lowBattery: false,
};

describe("showReadouts", () => {
  it("shows a readout per reading, in order", () => {
    showReadouts(container, template, [
      { ...reading, display: "temperature", label: "Chamber", value: 41.3 },
      reading,
    ]);

    assert.deepEqual(
      [...container.querySelectorAll(".readout")].map((readout) => [
        readout.querySelector(".label").textContent,
        readout.querySelector(".background").textContent,
        readout.querySelector(".value").textContent,
      ]),
      [
        ["Chamber", "88.8 88", "41.3 °C"],
        ["AMS", "88 ~", "14 %"],
      ]
    );
  });

  it("draws the icon, or hides it for none", () => {
    showReadouts(container, template, [reading, { ...reading, icon: "none" }]);
    const [ams, none] = container.querySelectorAll(".readout .icon");

    assert.ok(ams.querySelector("path").getAttribute("d"));
    assert.equal(ams.style.display, "");
    assert.equal(none.style.display, "none");
  });

  it("dims stale readings and replaces the previous readouts", () => {
    showReadouts(container, template, [{ ...reading, online: false }]);

    const readouts = container.querySelectorAll(".readout");
    assert.equal(readouts.length, 1);
    assert.ok(readouts[0].classList.contains("stale"));
    assert.equal(
      readouts[0].querySelector(".label").textContent,
      "AMS · offline"
    );

    showReadouts(container, template, []);
    assert.equal(container.children.length, 0);
  });
});
