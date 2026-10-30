import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fire, loadPage } from "./fakes.js";

/** @type {typeof import("./tabs.js").makeTabs} */
let makeTabs;
let window;
let tablist;
let form;

before(async () => {
  window = await loadPage();
  ({ makeTabs } = await import("./tabs.js"));
});

beforeEach(() => {
  // A fresh copy of the dialog, so listeners don't pile up between tests
  const dialog = document.querySelector("#dialog-settings");
  const fresh = dialog.cloneNode(true);
  dialog.replaceWith(fresh);
  form = fresh.querySelector("form");
  tablist = fresh.querySelector("[role='tablist']");
  makeTabs(tablist, form);
});

const tab = (name) => document.querySelector(`#tab-${name}`);
const panel = (name) => document.querySelector(`#panel-${name}`);
/** Which tab is selected and which panels show, by name. */
const state = () => ({
  selected: [...tablist.querySelectorAll("[aria-selected='true']")].map(
    (tab) => tab.id
  ),
  shown: ["sensors", "camera"].filter((name) => !panel(name).hidden),
  focusable: ["sensors", "camera"].filter((name) => tab(name).tabIndex === 0),
});

describe("makeTabs", () => {
  it("starts on the sensors tab", () => {
    assert.deepEqual(state(), {
      selected: ["tab-sensors"],
      shown: ["sensors"],
      focusable: ["sensors"],
    });
  });

  it("shows the clicked tab's panel", () => {
    fire(tab("camera"), "click");

    assert.deepEqual(state(), {
      selected: ["tab-camera"],
      shown: ["camera"],
      focusable: ["camera"],
    });
  });

  it("moves between tabs with the arrow keys, wrapping around", () => {
    const right = fire(tab("sensors"), "keydown", { key: "ArrowRight" });
    assert.equal(right.defaultPrevented, true);
    assert.deepEqual(state().shown, ["camera"]);
    assert.equal(document.activeElement, tab("camera"));

    fire(tab("camera"), "keydown", { key: "ArrowRight" });
    assert.deepEqual(state().shown, ["sensors"]);

    fire(tab("sensors"), "keydown", { key: "ArrowLeft" });
    assert.deepEqual(state().shown, ["camera"]);

    fire(tab("camera"), "keydown", { key: "Enter" });
    assert.deepEqual(state().shown, ["camera"]);
  });

  it("shows the tab of a field that fails validation", () => {
    fire(tab("camera"), "click");
    const list = panel("sensors").querySelector("#sensor-list");
    const select = document.createElement("select");
    list.append(select);

    select.dispatchEvent(new window.Event("invalid", { cancelable: true }));

    assert.deepEqual(state().shown, ["sensors"]);
  });

  it("keeps every tab's fields in the form", () => {
    fire(tab("sensors"), "click");

    const posted = [...new FormData(form).keys()];

    assert.ok(posted.includes("cameraHost"));
    assert.ok(posted.includes("cameraFit"));
  });
});
