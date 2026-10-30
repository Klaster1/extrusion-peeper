import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { Subscription } from "rxjs";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  updateSettings,
  watchSettings,
  type Settings,
} from "./settings.ts";
import {
  CAMERA_FITS,
  SENSOR_DISPLAYS,
  SENSOR_ICONS,
  type SensorSetting,
} from "./protocol.ts";
import { waitFor } from "./test-helpers.ts";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), "peeper-settings-"));
  file = path.join(dir, "settings.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const writeSettings = (settings: Partial<Settings> | string) =>
  fs.writeFile(
    file,
    typeof settings === "string" ? settings : JSON.stringify(settings)
  );

const chamber: SensorSetting = {
  deviceId: "chamber",
  display: "temperature",
  label: "Chamber",
  icon: "thermometer",
};
const ams: SensorSetting = {
  deviceId: "ams",
  display: "humidity",
  label: "AMS",
  icon: "spool",
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("loadSettings", () => {
  it("creates the file with defaults when it's missing", async () => {
    const settings = await loadSettings(file);

    assert.deepEqual(settings, DEFAULT_SETTINGS);
    assert.deepEqual(
      JSON.parse(await fs.readFile(file, "utf-8")),
      DEFAULT_SETTINGS
    );
  });

  it("fills in missing keys with defaults and keeps the file as is", async () => {
    await writeSettings({ cameraHost: "192.168.1.15" });

    const settings = await loadSettings(file);

    assert.equal(settings.cameraHost, "192.168.1.15");
    assert.equal(settings.port, DEFAULT_SETTINGS.port);
    assert.equal(
      await fs.readFile(file, "utf-8"),
      '{"cameraHost":"192.168.1.15"}'
    );
  });

  it("turns the old chamber temperature sensor into the first sensor", async () => {
    await writeSettings('{"temperatureSensorDeviceId":"chamber"}');

    const settings = await loadSettings(file);

    assert.deepEqual(settings.sensors, [chamber]);
    assert.equal("temperatureSensorDeviceId" in settings, false);
  });

  it("drops the old sensor once there's a sensor list or when it's unset", async () => {
    await writeSettings(
      JSON.stringify({ temperatureSensorDeviceId: "chamber", sensors: [ams] })
    );
    assert.deepEqual((await loadSettings(file)).sensors, [ams]);

    await writeSettings('{"temperatureSensorDeviceId":null}');
    assert.deepEqual((await loadSettings(file)).sensors, []);
  });

  it("fits the whole video in the page unless set otherwise", async () => {
    await writeSettings({});
    assert.equal((await loadSettings(file)).cameraFit, "fit");

    await writeSettings({ cameraFit: "fill" });
    assert.equal((await loadSettings(file)).cameraFit, "fill");

    await writeSettings(JSON.stringify({ cameraFit: "zoom" }));
    await assert.rejects(loadSettings(file));
  });

  it("rejects sensors that can't be displayed", async () => {
    await writeSettings(
      JSON.stringify({ sensors: [{ ...ams, display: "pressure" }] })
    );
    await assert.rejects(loadSettings(file));

    await writeSettings(
      JSON.stringify({ sensors: [{ ...ams, deviceId: "" }] })
    );
    await assert.rejects(loadSettings(file));
  });

  it("throws on invalid settings instead of falling back to defaults", async () => {
    await writeSettings("{ not json");
    await assert.rejects(loadSettings(file), SyntaxError);

    await writeSettings({ port: "2024" as any });
    await assert.rejects(loadSettings(file));
  });
});

describe("updateSettings", () => {
  it("merges the updates into the file", async () => {
    await writeSettings({ cameraHost: "192.168.1.15" });

    await updateSettings({ sensors: [ams] }, file);

    const saved = JSON.parse(await fs.readFile(file, "utf-8"));
    assert.equal(saved.cameraHost, "192.168.1.15");
    assert.deepEqual(saved.sensors, [ams]);
  });

  it("saves the old chamber sensor in the new format", async () => {
    await writeSettings(
      JSON.stringify({
        temperatureSensorDeviceId: "chamber",
        sensors: undefined,
      })
    );

    await updateSettings({ port: 2025 }, file);

    const saved = JSON.parse(await fs.readFile(file, "utf-8"));
    assert.equal(saved.temperatureSensorDeviceId, undefined);
    assert.deepEqual(saved.sensors, [chamber]);
  });
});

describe("watchSettings", () => {
  let subscription: Subscription;
  let emitted: Settings[];

  beforeEach(async () => {
    await writeSettings({ port: 1 });
    emitted = [];
    subscription = watchSettings(file).subscribe((settings) =>
      emitted.push(settings)
    );
    await waitFor(() => emitted.length === 1);
  });

  afterEach(() => subscription.unsubscribe());

  it("emits the current settings, then once per save", async () => {
    await writeSettings({ port: 2 });
    await writeSettings({ port: 3 });
    await waitFor(() => emitted.length === 2);
    await delay(300);

    assert.deepEqual(
      emitted.map((settings) => settings.port),
      [1, 3]
    );
  });

  it("doesn't emit when a save changes nothing", async () => {
    await writeSettings({ port: 1 });
    await delay(300);

    assert.equal(emitted.length, 1);
  });

  it("skips an invalid file and picks up the next valid one", async () => {
    await writeSettings("{ half-written");
    await delay(300);
    await writeSettings({ port: 2 });
    await waitFor(() => emitted.length === 2);

    assert.equal(emitted[1].port, 2);
  });
});

describe("settings.schema.json", () => {
  it("allows the same values as the app", async () => {
    const schema = JSON.parse(
      await fs.readFile(
        path.join(import.meta.dirname, "..", "settings.schema.json"),
        "utf-8"
      )
    );
    const sensor = schema.properties.sensors.items.properties;

    assert.deepEqual(sensor.display.enum, SENSOR_DISPLAYS);
    assert.deepEqual(sensor.icon.enum, SENSOR_ICONS);
    assert.deepEqual(schema.properties.cameraFit.enum, CAMERA_FITS);
    assert.equal(
      schema.properties.cameraFit.default,
      DEFAULT_SETTINGS.cameraFit
    );
    assert.deepEqual(
      Object.keys(schema.properties).sort(),
      Object.keys(DEFAULT_SETTINGS).sort()
    );
  });
});
