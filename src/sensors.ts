import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  exhaustMap,
  from,
  map,
  timer,
  type Observable,
} from "rxjs";
import { isDeepStrictEqual } from "util";
import type {
  TapoChildDeviceListResponse,
  TapoSensorDevice,
} from "./tapo-api.ts";
import type { SensorOption, SensorReading, SensorSetting } from "./protocol.ts";

// Tapo sensors report every few seconds at best, so polling faster gains nothing
export const POLL_INTERVAL_MS = 10_000;

export type HubSession = {
  getChildDeviceList(): Promise<TapoChildDeviceListResponse>;
};

export type Sensor = SensorOption & {
  temperature: number | null;
  humidity: number | null;
};

/**
 * Returns a function that reads the temperature and humidity sensors of every hub. It logs
 * into the hubs on the first read and again only after a read fails.
 */
export const createSensorReader = (
  connectHubs: () => Promise<HubSession[]>
) => {
  let hubs: Promise<HubSession[]> | undefined;
  return async (): Promise<TapoSensorDevice[]> => {
    hubs ??= connectHubs();
    try {
      const lists = await Promise.all(
        (await hubs).map((hub) => hub.getChildDeviceList())
      );
      return lists
        .flatMap((list) => list.child_device_list)
        .filter(
          (device) => device.category === "subg.trigger.temp-hmdt-sensor"
        );
    } catch (error) {
      hubs = undefined;
      throw error;
    }
  };
};

/** Reads now and then every interval, skipping a tick while a read is still running. */
export const pollSensors = (
  read: () => Promise<TapoSensorDevice[]>,
  intervalMs = POLL_INTERVAL_MS
) =>
  timer(0, intervalMs).pipe(
    exhaustMap(() =>
      from(read()).pipe(
        catchError((error) => {
          console.error("Error reading sensors:", error);
          return EMPTY;
        })
      )
    )
  );

const decodeDeviceName = (name: string) =>
  Buffer.from(name, "base64").toString("utf-8");

export const toSensors = (
  devices$: Observable<TapoSensorDevice[]>
): Observable<Sensor[]> =>
  devices$.pipe(
    map((devices) =>
      devices.map((device) => ({
        id: device.device_id,
        name: decodeDeviceName(device.nickname),
        temperature: device.current_temp ?? null,
        humidity: device.current_humidity ?? null,
        // The hub keeps the last reading of a sensor it lost contact with
        online: device.status === "online",
        lowBattery: device.at_low_battery,
      }))
    )
  );

/** The readouts in their settings order, each with the reading it displays. */
export const sensorReadings = (
  sensors$: Observable<Sensor[]>,
  settings$: Observable<SensorSetting[]>
) =>
  combineLatest([sensors$, settings$]).pipe(
    map(([sensors, settings]) =>
      settings.map(({ deviceId, display, label, icon }): SensorReading => {
        const sensor = sensors.find((sensor) => sensor.id === deviceId);
        return {
          display,
          label: label || sensor?.name || "",
          icon,
          value: sensor?.[display] ?? null,
          online: sensor?.online ?? true,
          lowBattery: sensor?.lowBattery ?? false,
        };
      })
    ),
    distinctUntilChanged<SensorReading[]>(isDeepStrictEqual)
  );

/** The sensor list without readings, so the settings dropdowns only update when it changes. */
export const sensorOptions = (sensors$: Observable<Sensor[]>) =>
  sensors$.pipe(
    map((sensors) =>
      sensors.map(
        ({ temperature, humidity, ...option }): SensorOption => option
      )
    ),
    distinctUntilChanged<SensorOption[]>(isDeepStrictEqual)
  );
