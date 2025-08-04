import {
  distinctUntilChanged,
  filter,
  map,
  merge,
  Observable,
  of,
  shareReplay,
  switchMap,
  timer,
  withLatestFrom,
} from "rxjs";
import { tapoFullCredentials$ } from "./credentials.ts";
import { listDevices, loginDevice } from "./tapo-api.ts";
import type { TapoCredentials } from "./credentials.ts";
import { settings$ } from "./settings.ts";

// export const getTemperature = async (credentials: TapoCredentials) => {
//   const devices = await listDevices(credentials.token);
//   const firstHub = devices.find(
//     (device) => device.deviceType === "SMART.TAPOHUB"
//   );
//   const hubDevice = await loginDevice(
//     credentials.login,
//     credentials.password,
//     firstHub!
//   );
//   const hubDevices = (await hubDevice.getChildDeviceList())?.child_device_list;
//   const temperatureSensor = hubDevices?.find(
//     (device) =>
//       device.category === "subg.trigger.temp-hmdt-sensor" &&
//       device.status === "online"
//   );
//   if (!temperatureSensor) {
//     throw new Error("Temperature sensor not found");
//   }
//   return temperatureSensor?.current_temp;
// };

const getAllTemperatureDevices = async (credentials: TapoCredentials) => {
  const devices = await listDevices(credentials.token);
  const hubs = devices.filter(
    (device) => device.deviceType === "SMART.TAPOHUB"
  );
  const hubDevices = await Promise.all(
    hubs.map((hub) => loginDevice(credentials.login, credentials.password, hub))
  );
  const hubChildrenDevices = (
    await Promise.all(
      hubDevices.map((device) =>
        device.getChildDeviceList().then((list) => list.child_device_list)
      )
    )
  ).flat();
  const temperatureDevices = hubChildrenDevices.filter(
    (device) => device.category === "subg.trigger.temp-hmdt-sensor"
  );
  return temperatureDevices;
};

export type TemperatureDevice = {
  id: string;
  name: string;
  temperature?: number;
  online: boolean;
  selected: boolean;
};

const decodeDeviceName = (name: string) => {
  return Buffer.from(name, "base64").toString("utf-8");
};

const currentTemperatureSensorDeviceId$ = settings$.pipe(
  map((settings) => settings.temperatureSensorDeviceId),
  distinctUntilChanged()
);

export const temperatureDevices$ = tapoFullCredentials$.pipe(
  filter((credentials) => !!credentials),
  withLatestFrom(currentTemperatureSensorDeviceId$),
  switchMap(async ([credentials, currentSensorId]) => {
    const devices = await getAllTemperatureDevices(credentials);
    return devices.map(
      (device): TemperatureDevice => ({
        id: device.device_id,
        name: decodeDeviceName(device.nickname),
        temperature: device.current_temp,
        online: device.status === "online",
        selected: device.device_id === currentSensorId,
      })
    );
  })
);

export const temperature$: Observable<number | undefined> = timer(
  0,
  1_000
).pipe(
  switchMap(() => temperatureDevices$),
  map((devices) => {
    const selectedDevice = devices.find((device) => device.selected);
    return selectedDevice?.temperature;
  }),
  distinctUntilChanged(),
  shareReplay({
    refCount: true,
    bufferSize: 1,
  })
);
