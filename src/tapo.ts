import {
  distinctUntilChanged,
  firstValueFrom,
  map,
  of,
  retry,
  shareReplay,
  skip,
  startWith,
  switchMap,
  take,
  throwError,
} from "rxjs";
import { isDeepStrictEqual } from "util";
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
  sensorOptions,
  sensorReadings,
  toSensors,
} from "./sensors.ts";
import type { SensorSetting } from "./protocol.ts";

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

const sensors$ = toSensors(
  tapoFullCredentials$.pipe(
    switchMap((credentials) =>
      credentials
        ? pollSensors(createSensorReader(() => connectHubs(credentials)))
        : of([])
    ),
    // Shows the readouts with dashes until the first read
    startWith([])
  )
).pipe(
  shareReplay({
    refCount: true,
    bufferSize: 1,
  })
);

export const sensorReadings$ = sensorReadings(
  sensors$,
  settings$.pipe(
    map((settings) => settings.sensors),
    distinctUntilChanged<SensorSetting[]>(isDeepStrictEqual)
  )
);

export const sensorOptions$ = sensorOptions(sensors$);
