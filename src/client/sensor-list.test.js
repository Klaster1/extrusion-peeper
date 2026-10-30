import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fire, loadPage } from "./fakes.js";

/** @type {typeof import("./sensor-list.js")} */
let module;
let list;
let form;
let sensors;

before(async () => {
  await loadPage();
  module = await import("./sensor-list.js");
  list = document.querySelector("#sensor-list");
  form = document.querySelector("#dialog-settings form");
});

beforeEach(() => {
  // A fresh list element, so listeners don't pile up between tests
  const fresh = list.cloneNode(false);
  list.replaceWith(fresh);
  list = fresh;
  sensors = module.createSensorList(
    list,
    document.querySelector("#template-sensor")
  );
});

const options = [
  { id: "chamber", name: "Printer", online: true, lowBattery: false },
  { id: "ams", name: "AMS", online: true, lowBattery: false },
];
const chamber = {
  deviceId: "chamber",
  display: "temperature",
  label: "Chamber",
  icon: "chamber",
};
const ams = { deviceId: "ams", display: "humidity", label: "", icon: "ams" };

const cards = () => [...list.children];
const titles = () =>
  cards().map((card) => card.querySelector(".title").textContent);
/** What the form posts for its sensors, field by field. */
const posted = () => {
  const data = new FormData(form);
  return ["sensorDeviceId", "sensorDisplay", "sensorLabel", "sensorIcon"].map(
    (name) => data.getAll(name)
  );
};

describe("createSensorList", () => {
  it("shows a card per saved sensor, which the form posts in order", () => {
    sensors.setOptions(options);
    sensors.show([chamber, ams]);

    assert.deepEqual(titles(), ["Chamber", "AMS"]);
    assert.deepEqual(posted(), [
      ["chamber", "ams"],
      ["temperature", "humidity"],
      ["Chamber", ""],
      ["chamber", "ams"],
    ]);
  });

  it("offers every icon, drawn next to its name", () => {
    sensors.show([ams]);
    const { icon } = module.sensorFields(cards()[0]);

    assert.deepEqual(
      [...icon.options].map((option) => [
        option.value,
        option.textContent,
        Boolean(option.querySelector("svg path")?.getAttribute("d")),
      ]),
      [
        ["thermometer", "Thermometer", true],
        ["droplet", "Droplet", true],
        ["chamber", "Chamber", true],
        ["ams", "AMS", true],
        ["printer", "Printer", true],
        ["spool", "Spool", true],
        ["none", "None", false],
      ]
    );
  });

  it("previews the icon and caption in the card's heading as they're edited", () => {
    sensors.setOptions(options);
    sensors.show([ams]);
    const card = cards()[0];
    const fields = module.sensorFields(card);
    const headingIcon = () =>
      card.querySelector(".sensor-header .icon path").getAttribute("d");
    const amsIcon = headingIcon();

    fields.label.value = "Dry box";
    fire(fields.label, "input");
    fields.icon.value = "spool";
    fire(fields.icon, "input");

    assert.deepEqual(titles(), ["Dry box"]);
    assert.notEqual(headingIcon(), amsIcon);
  });

  it("swaps the default icon when the display changes", () => {
    sensors.add();
    const fields = module.sensorFields(cards()[0]);

    fields.display.value = "humidity";
    fire(fields.display, "change");
    assert.equal(fields.icon.value, "droplet");

    fields.icon.value = "ams";
    fields.display.value = "temperature";
    fire(fields.display, "change");
    assert.equal(fields.icon.value, "ams");
  });

  it("adds an empty temperature card and focuses its device", () => {
    sensors.show([chamber]);
    sensors.add();

    assert.deepEqual(titles(), ["Chamber", "New sensor"]);
    const added = module.sensorFields(cards()[1]);
    assert.equal(document.activeElement, added.device);
    assert.deepEqual(
      [added.device.value, added.display.value, added.icon.value],
      ["", "temperature", "thermometer"]
    );
    assert.ok(added.device.required);
  });

  it("removes a card with its button", () => {
    sensors.show([chamber, ams]);

    fire(cards()[0].querySelector("[data-remove]"), "click");

    assert.deepEqual(posted()[0], ["ams"]);
  });

  it("discards unsaved changes when shown again", () => {
    sensors.show([chamber]);
    sensors.add();
    module.sensorFields(cards()[0]).label.value = "Edited";

    sensors.show([chamber]);

    assert.deepEqual(posted()[2], ["Chamber"]);
  });

  it("updates the device choices and keeps what each card picked", () => {
    sensors.show([ams, { ...chamber, deviceId: "gone" }]);
    assert.deepEqual(titles(), ["New sensor", "Chamber"]);

    sensors.setOptions(options);

    assert.deepEqual(titles(), ["AMS", "Chamber"]);
    const [first, second] = cards().map(
      (card) => module.sensorFields(card).device
    );
    assert.equal(first.value, "ams");
    assert.equal(second.value, "gone");
    assert.match(second.selectedOptions[0].textContent, /Unknown sensor gone/);
  });
});

describe("reordering", () => {
  /** Lays the cards out 100px apart, as the browser would. */
  const layOut = () =>
    cards().forEach((card, index) => {
      card.getBoundingClientRect = () => ({ top: index * 100, height: 100 });
    });
  const handle = (card) => card.querySelector(".drag-handle");
  const dataTransfer = { effectAllowed: "", setData() {} };

  it("moves a card dragged by its handle", () => {
    sensors.show([chamber, ams, { ...ams, label: "Third" }]);
    layOut();
    const [first] = cards();

    fire(handle(first), "pointerdown");
    assert.equal(first.draggable, true);
    fire(first, "dragstart", { dataTransfer });
    assert.ok(first.classList.contains("dragging"));
    const over = fire(list, "dragover", { clientY: 260 });
    fire(first, "dragend");

    assert.equal(over.defaultPrevented, true);
    assert.deepEqual(posted()[2], ["", "Third", "Chamber"]);
    assert.equal(first.draggable, false);
    assert.ok(!first.classList.contains("dragging"));
  });

  it("drags only by the handle", () => {
    sensors.show([chamber, ams]);
    const [first] = cards();

    fire(module.sensorFields(first).label, "pointerdown");
    // happy-dom leaves draggable unset rather than false
    assert.notEqual(first.draggable, true);

    fire(handle(first), "pointerdown");
    fire(handle(first), "pointerup");
    assert.equal(first.draggable, false);
  });

  it("moves a card with the arrow keys on its handle", () => {
    sensors.show([chamber, ams]);
    const [first] = cards();

    const down = fire(handle(first), "keydown", { key: "ArrowDown" });
    assert.equal(down.defaultPrevented, true);
    assert.deepEqual(posted()[2], ["", "Chamber"]);

    fire(handle(first), "keydown", { key: "ArrowDown" });
    assert.deepEqual(posted()[2], ["", "Chamber"]);

    fire(handle(first), "keydown", { key: "ArrowUp" });
    assert.deepEqual(posted()[2], ["Chamber", ""]);
    assert.equal(document.activeElement, handle(first));
  });

  it("ignores arrow keys outside the handle", () => {
    sensors.show([chamber, ams]);

    fire(module.sensorFields(cards()[0]).label, "keydown", {
      key: "ArrowDown",
    });

    assert.deepEqual(posted()[2], ["Chamber", ""]);
  });
});
