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
  sensorOptions,
  sensorReadings,
  toSensors,
  type HubSession,
  type Sensor,
} from "./sensors.ts";
import type { TapoSensorDevice } from "./tapo-api.ts";
import type { SensorOption, SensorReading, SensorSetting } from "./protocol.ts";

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

describe("toSensors", () => {
  it("decodes names and reads temperature and humidity", () => {
    const emitted: Sensor[][] = [];
    toSensors(
      of([
        sensor("a", { at_low_battery: false, current_humidity: 40 }),
        sensor("b", {
          status: "offline",
          at_low_battery: true,
          current_temp: undefined,
        }),
      ])
    ).subscribe((sensors) => emitted.push(sensors));

    assert.deepEqual(emitted, [
      [
        {
          id: "a",
          name: "Sensor a",
          temperature: 25,
          humidity: 40,
          online: true,
          lowBattery: false,
        },
        {
          id: "b",
          name: "Sensor b",
          temperature: null,
          humidity: null,
          online: false,
          lowBattery: true,
        },
      ],
    ]);
  });
});

const chamberSensor: Sensor = {
  id: "chamber",
  name: "T310",
  temperature: 41.2,
  humidity: 18,
  online: true,
  lowBattery: false,
};
const amsSensor: Sensor = {
  id: "ams",
  name: "T315",
  temperature: 26,
  humidity: 12,
  online: false,
  lowBattery: true,
};
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

describe("sensorReadings", () => {
  it("shows what each sensor is set to display, in the settings order", () => {
    const emitted: SensorReading[][] = [];
    sensorReadings(
      of([chamberSensor, amsSensor]),
      of([ams, chamber])
    ).subscribe((readings) => emitted.push(readings));

    assert.deepEqual(emitted, [
      [
        {
          display: "humidity",
          label: "AMS",
          icon: "spool",
          value: 12,
          online: false,
          lowBattery: true,
        },
        {
          display: "temperature",
          label: "Chamber",
          icon: "thermometer",
          value: 41.2,
          online: true,
          lowBattery: false,
        },
      ],
    ]);
  });

  it("can show both readings of one sensor", () => {
    const emitted: SensorReading[][] = [];
    sensorReadings(
      of([chamberSensor]),
      of([chamber, { ...chamber, display: "humidity" }])
    ).subscribe((readings) => emitted.push(readings));

    assert.deepEqual(
      emitted[0].map((reading) => reading.value),
      [41.2, 18]
    );
  });

  it("labels a sensor with its name when the label is empty", () => {
    const emitted: SensorReading[][] = [];
    sensorReadings(of([amsSensor]), of([{ ...ams, label: "" }])).subscribe(
      (readings) => emitted.push(readings)
    );

    assert.equal(emitted[0][0].label, "T315");
  });

  it("shows no value for a sensor the hubs don't list", () => {
    const emitted: SensorReading[][] = [];
    sensorReadings(of([]), of([{ ...ams, label: "" }])).subscribe((readings) =>
      emitted.push(readings)
    );

    assert.deepEqual(emitted[0], [
      {
        display: "humidity",
        label: "",
        icon: "spool",
        value: null,
        online: true,
        lowBattery: false,
      },
    ]);
  });

  it("emits when the readings or settings change, but not for the same readings", () => {
    const sensors$ = new Subject<Sensor[]>();
    const settings$ = new BehaviorSubject<SensorSetting[]>([chamber]);
    const emitted: SensorReading[][] = [];
    sensorReadings(sensors$, settings$).subscribe((readings) =>
      emitted.push(readings)
    );

    sensors$.next([chamberSensor]);
    sensors$.next([chamberSensor, amsSensor]);
    sensors$.next([{ ...chamberSensor, temperature: 42 }]);
    settings$.next([chamber, ams]);
    settings$.next([]);

    assert.deepEqual(
      emitted.map((readings) => readings.map((reading) => reading.value)),
      [[41.2], [42], [42, null], []]
    );
  });
});

describe("sensorOptions", () => {
  it("emits the options without readings, only when they change", () => {
    const sensors$ = new Subject<Sensor[]>();
    const emitted: SensorOption[][] = [];
    sensorOptions(sensors$).subscribe((options) => emitted.push(options));

    sensors$.next([chamberSensor]);
    sensors$.next([{ ...chamberSensor, temperature: 50, humidity: 5 }]);
    sensors$.next([{ ...chamberSensor, online: false }]);

    assert.deepEqual(emitted, [
      [{ id: "chamber", name: "T310", online: true, lowBattery: false }],
      [{ id: "chamber", name: "T310", online: false, lowBattery: false }],
    ]);
  });
});
