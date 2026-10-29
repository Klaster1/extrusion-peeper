import {
  distinctUntilChanged,
  firstValueFrom,
  map,
  of,
  retry,
  shareReplay,
  skip,
  switchMap,
  take,
  throwError,
} from "rxjs";
import {
  refreshTapoToken,
  tapoFullCredentials$,
  tapoToken$,
} from "./credentials.ts";
import { listDevices, loginDevice, TapoTokenExpiredError } from "./tapo-api.ts";
import type { TapoCredentials } from "./credentials.ts";
import { settings$ } from "./settings.ts";
import {
  createSensorReader,
  pollSensors,
  selectedReading,
  sensorOptions,
  toTemperatureSensors,
} from "./sensors.ts";

const listDevices$ = tapoToken$.pipe(
  take(1),
  switchMap((token) => listDevices(token)),
  retry({
    count: 1,
    delay: (e) => {
      if (!(e instanceof TapoTokenExpiredError)) {
        return throwError(() => e);
      }
      refreshTapoToken();
      // The first value is the replayed stale token
      return tapoToken$.pipe(skip(1), take(1));
    },
  })
);

const connectHubs = async (credentials: TapoCredentials) => {
  const devices = await firstValueFrom(listDevices$);
  const hubs = devices.filter(
    (device) => device.deviceType === "SMART.TAPOHUB"
  );
  return Promise.all(
    hubs.map((hub) => loginDevice(credentials.login, credentials.password, hub))
  );
};

const currentTemperatureSensorDeviceId$ = settings$.pipe(
  map((settings) => settings.temperatureSensorDeviceId),
  distinctUntilChanged()
);

const temperatureSensors$ = toTemperatureSensors(
  tapoFullCredentials$.pipe(
    switchMap((credentials) =>
      credentials
        ? pollSensors(createSensorReader(() => connectHubs(credentials)))
        : of([])
    )
  ),
  currentTemperatureSensorDeviceId$
).pipe(
  shareReplay({
    refCount: true,
    bufferSize: 1,
  })
);

export const temperature$ = selectedReading(temperatureSensors$);

export const sensorOptions$ = sensorOptions(temperatureSensors$);
