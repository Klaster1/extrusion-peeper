import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isStale,
  sensorLabel,
  temperatureLabel,
  temperatureText,
} from "./format.js";

const reading = { temperature: 32.6, online: true, lowBattery: false };

describe("temperature overlay", () => {
  it("shows the reading, or dashes when there's none", () => {
    assert.equal(temperatureText(reading), "32.6 °C");
    assert.equal(temperatureText({ ...reading, temperature: null }), "--.- °C");
    assert.equal(temperatureText(null), "--.- °C");
  });

  it("flags offline sensors and low batteries in the caption", () => {
    assert.equal(temperatureLabel(reading), "Chamber");
    assert.equal(temperatureLabel(null), "Chamber");
    assert.equal(
      temperatureLabel({ ...reading, online: false, lowBattery: true }),
      "Chamber · offline · low battery"
    );
  });

  it("treats an offline sensor's reading as stale", () => {
    assert.equal(isStale(reading), false);
    assert.equal(isStale({ ...reading, online: false }), true);
    assert.equal(isStale(null), false);
  });
});

describe("sensorLabel", () => {
  const sensor = {
    id: "a",
    name: "Printer",
    online: true,
    lowBattery: false,
    selected: true,
  };

  it("shows whether the sensor is online and its battery is low", () => {
    assert.equal(sensorLabel(sensor), "🟢 Printer");
    assert.equal(
      sensorLabel({ ...sensor, online: false, lowBattery: true }),
      "🔴 Printer (low battery)"
    );
  });
});
