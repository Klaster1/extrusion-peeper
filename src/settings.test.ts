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

    await updateSettings({ temperatureSensorDeviceId: "sensor" }, file);

    const saved = JSON.parse(await fs.readFile(file, "utf-8"));
    assert.equal(saved.cameraHost, "192.168.1.15");
    assert.equal(saved.temperatureSensorDeviceId, "sensor");
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
