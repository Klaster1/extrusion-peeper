import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  BehaviorSubject,
  firstValueFrom,
  of,
  Subject,
  take,
  toArray,
} from "rxjs";
import {
  createSensorReader,
  pollSensors,
  selectedReading,
  sensorOptions,
  toTemperatureSensors,
  type HubSession,
  type TemperatureSensor,
} from "./sensors.ts";
import type { TapoSensorDevice } from "./tapo-api.ts";
import type { SensorOption, TemperatureReading } from "./protocol.ts";

const sensor = (
  id: string,
  overrides: Partial<TapoSensorDevice> = {}
): TapoSensorDevice =>
  ({
    device_id: id,
    nickname: Buffer.from(`Sensor ${id}`).toString("base64"),
    category: "subg.trigger.temp-hmdt-sensor",
    status: "online",
    current_temp: 25,
    ...overrides,
  }) as TapoSensorDevice;

const hub = (devices: TapoSensorDevice[]): HubSession => ({
  getChildDeviceList: mock.fn(async () => ({
    child_device_list: devices,
    start_index: 0,
    sum: devices.length,
  })),
});

describe("createSensorReader", () => {
  it("logs into the hubs once and reads only temperature sensors", async () => {
    const button = sensor("button", { category: "subg.trigger.button" });
    const connectHubs = mock.fn(async () => [
      hub([sensor("a"), button]),
      hub([sensor("b")]),
    ]);
    const read = createSensorReader(connectHubs);

    await read();
    const devices = await read();

    assert.equal(connectHubs.mock.callCount(), 1);
    assert.deepEqual(
      devices.map((device) => device.device_id),
      ["a", "b"]
    );
  });

  it("logs in again after a read fails", async () => {
    const failing: HubSession = {
      getChildDeviceList: async () => {
        throw new Error("Session expired");
      },
    };
    const connectHubs = mock.fn(async () =>
      connectHubs.mock.callCount() === 0 ? [failing] : [hub([sensor("a")])]
    );
    const read = createSensorReader(connectHubs);

    await assert.rejects(read(), /Session expired/);
    const devices = await read();

    assert.equal(connectHubs.mock.callCount(), 2);
    assert.equal(devices[0].device_id, "a");
  });
});

describe("pollSensors", () => {
  it("keeps polling after a failed read", async () => {
    mock.method(console, "error", () => {});
    let calls = 0;
    const read = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("Offline");
      }
      return [sensor(String(calls))];
    };

    const results = await firstValueFrom(
      pollSensors(read, 5).pipe(take(2), toArray())
    );

    assert.deepEqual(
      results.map(([device]) => device.device_id),
      ["2", "3"]
    );
  });

  it("doesn't start a read while the previous one is running", async () => {
    let running = 0;
    let maxRunning = 0;
    const read = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 30));
      running -= 1;
      return [];
    };

    await firstValueFrom(pollSensors(read, 5).pipe(take(3), toArray()));

    assert.equal(maxRunning, 1);
  });
});

describe("toTemperatureSensors", () => {
  it("decodes names and follows the selected sensor as it changes", () => {
    const selectedId$ = new BehaviorSubject<string | null>("a");
    const emitted: TemperatureSensor[][] = [];
    toTemperatureSensors(
      of([
        sensor("a", { at_low_battery: false }),
        sensor("b", { status: "offline", at_low_battery: true }),
      ]),
      selectedId$
    ).subscribe((sensors) => emitted.push(sensors));

    selectedId$.next("b");

    assert.deepEqual(emitted[0], [
      {
        id: "a",
        name: "Sensor a",
        temperature: 25,
        online: true,
        lowBattery: false,
        selected: true,
      },
      {
        id: "b",
        name: "Sensor b",
        temperature: 25,
        online: false,
        lowBattery: true,
        selected: false,
      },
    ]);
    assert.deepEqual(
      emitted[1].map((s) => s.selected),
      [false, true]
    );
  });

  it("reports a sensor without a reading as null", () => {
    const emitted: TemperatureSensor[][] = [];
    toTemperatureSensors(
      of([sensor("a", { current_temp: undefined })]),
      of("a")
    ).subscribe((sensors) => emitted.push(sensors));

    assert.equal(emitted[0][0].temperature, null);
  });
});

describe("selectedReading and sensorOptions", () => {
  const reading = (
    temperature: number,
    { selected = true, online = true } = {}
  ): TemperatureSensor[] => [
    { id: "a", name: "A", online, lowBattery: false, selected, temperature },
  ];

  it("emits the selected sensor's reading when it changes", () => {
    const sensors$ = new Subject<TemperatureSensor[]>();
    const emitted: (TemperatureReading | null)[] = [];
    selectedReading(sensors$).subscribe((r) => emitted.push(r));

    sensors$.next(reading(25));
    sensors$.next(reading(25));
    sensors$.next(reading(25, { online: false }));
    sensors$.next(reading(26, { selected: false }));

    assert.deepEqual(emitted, [
      { temperature: 25, online: true, lowBattery: false },
      { temperature: 25, online: false, lowBattery: false },
      null,
    ]);
  });

  it("emits the options without readings, only when they change", () => {
    const sensors$ = new Subject<TemperatureSensor[]>();
    const emitted: SensorOption[][] = [];
    sensorOptions(sensors$).subscribe((options) => emitted.push(options));

    sensors$.next(reading(25));
    sensors$.next(reading(26));
    sensors$.next(reading(26, { selected: false }));

    assert.deepEqual(emitted, [
      [{ id: "a", name: "A", online: true, lowBattery: false, selected: true }],
      [
        {
          id: "a",
          name: "A",
          online: true,
          lowBattery: false,
          selected: false,
        },
      ],
    ]);
  });
});
