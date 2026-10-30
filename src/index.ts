import { settings$, updateSettings } from "./settings.ts";
import { sensorOptions$, sensorReadings$ } from "./tapo.ts";
import { cameraConfigChanges, createCameraRelay } from "./camera.ts";
import { createApp, serveOnPort } from "./app.ts";

const { listen } = createApp({
  settings$,
  sensorReadings$,
  sensorOptions$,
  cameraRelay: createCameraRelay(cameraConfigChanges(settings$)),
  updateSettings,
});

serveOnPort(settings$, listen).subscribe((port) => {
  console.log(
    `You can now peep at extrusions over at: http://localhost:${port}`
  );
});
