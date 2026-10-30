import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deviceChoices,
  iconAfterDisplayChange,
  isStale,
  OBJECT_FITS,
  readingBackground,
  readingLabel,
  readingText,
  sensorLabel,
  sensorTitle,
} from "./format.js";

/** @type {import("../protocol.ts").SensorReading} */
const temperature = {
  display: "temperature",
  label: "Chamber",
  icon: "thermometer",
  value: 32.6,
  online: true,
  lowBattery: false,
};
const humidity = {
  ...temperature,
  display: "humidity",
  label: "AMS",
  value: 12,
};

describe("readout", () => {
  it("shows the reading with its unit, or dashes when there's none", () => {
    assert.equal(readingText(temperature), "32.6 °C");
    assert.equal(readingText({ ...temperature, value: null }), "--.- °C");
    assert.equal(readingText(humidity), "12 %");
    assert.equal(readingText({ ...humidity, value: null }), "-- %");
  });

  it("puts unlit segments behind the reading", () => {
    assert.equal(readingBackground("temperature"), "88.8 88");
    assert.equal(readingBackground("humidity"), "88 ~");
  });

  it("flags offline sensors and low batteries in the caption", () => {
    assert.equal(readingLabel(temperature), "Chamber");
    assert.equal(
      readingLabel({ ...humidity, online: false, lowBattery: true }),
      "AMS · offline · low battery"
    );
    assert.equal(
      readingLabel({ ...humidity, label: "", online: false }),
      "offline"
    );
  });

  it("treats an offline sensor's reading as stale", () => {
    assert.equal(isStale(temperature), false);
    assert.equal(isStale({ ...temperature, online: false }), true);
  });
});

describe("sensorLabel", () => {
  const sensor = {
    id: "a",
    name: "Printer",
    online: true,
    lowBattery: false,
  };

  it("shows whether the sensor is online and its battery is low", () => {
    assert.equal(sensorLabel(sensor), "🟢 Printer");
    assert.equal(
      sensorLabel({ ...sensor, online: false, lowBattery: true }),
      "🔴 Printer (low battery)"
    );
  });
});

describe("sensor settings", () => {
  const sensors = [
    { id: "chamber", name: "T310", online: true, lowBattery: false },
    { id: "ams", name: "T315", online: false, lowBattery: true },
  ];

  it("offers every sensor the hubs list", () => {
    assert.deepEqual(deviceChoices(sensors, "ams"), [
      { value: "", label: "Select sensor" },
      { value: "chamber", label: "🟢 T310" },
      { value: "ams", label: "🔴 T315 (low battery)" },
    ]);
  });

  it("keeps a saved sensor the hubs no longer list", () => {
    assert.deepEqual(deviceChoices([], "gone"), [
      { value: "", label: "Select sensor" },
      { value: "gone", label: "🔴 Unknown sensor gone" },
    ]);
    assert.equal(deviceChoices([], "").length, 1);
  });

  it("swaps the icon along with the display, unless it was picked by hand", () => {
    assert.equal(
      iconAfterDisplayChange("thermometer", "temperature", "humidity"),
      "droplet"
    );
    assert.equal(
      iconAfterDisplayChange("droplet", "humidity", "temperature"),
      "thermometer"
    );
    assert.equal(
      iconAfterDisplayChange("spool", "temperature", "humidity"),
      "spool"
    );
  });

  it("titles a sensor by its label, its device's name, or as new", () => {
    assert.equal(sensorTitle(" AMS ", "ams", sensors), "AMS");
    assert.equal(sensorTitle("", "ams", sensors), "T315");
    assert.equal(sensorTitle("", "", sensors), "New sensor");
  });
});

describe("OBJECT_FITS", () => {
  it("shows the whole video, crops it, or stretches it", () => {
    assert.deepEqual(OBJECT_FITS, {
      fit: "contain",
      fill: "cover",
      stretch: "fill",
    });
  });
});
