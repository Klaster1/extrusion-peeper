import expressWs from "express-ws";
import { settings$, updateSettings } from "./settings.ts";
import type { Settings } from "./settings.ts";
import { join } from "path";
import { lookup } from "mime-types";
import express from "express";
import { temperature$, temperatureDevices$ } from "./temperature.ts";
import { Observable, switchMap } from "rxjs";
import { makeCameraHandler } from "./camera.ts";

const makeApp = (): expressWs.Application => {
  const expressWsInstance = expressWs(express());
  return expressWsInstance.app;
};

const app = makeApp();

app.use(
  "/node_modules",
  (req, res, next) => {
    const type = lookup(req.path);
    if (type) {
      res.type(type);
    }
    next();
  },
  express.static(join(import.meta.dirname, "..", "node_modules"))
);

app.get("/", (req, res) => {
  res.sendFile(join(import.meta.dirname, "index.html"));
});

app.ws("/api/temperature", (ws) => {
  temperature$.subscribe((temp) => {
    ws.send(JSON.stringify(temp));
  });
});

app.ws("/api/sensors", (ws) => {
  temperatureDevices$.subscribe((devices) => {
    ws.send(JSON.stringify(devices));
  });
});

app.ws("/api/settings", (ws) => {
  settings$.subscribe((settings) => {
    ws.send(
      JSON.stringify({
        cameraHost: settings.cameraHost,
        cameraLogin: settings.cameraLogin,
      } satisfies Partial<Settings>)
    );
  });
});

app.post(
  "/api/settings",
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const { sensorDeviceId, cameraHost, cameraLogin, cameraPassword } =
      req.body;
    if (!sensorDeviceId) {
      return res.status(400).send("Sensor ID is required.");
    }
    const cameraSettings: Partial<Settings> =
      !!cameraHost && !!cameraLogin && !!cameraPassword
        ? {
            cameraHost,
            cameraLogin,
            cameraPassword,
          }
        : {};
    await updateSettings({
      temperatureSensorDeviceId: sensorDeviceId,
      ...cameraSettings,
    });
    res.redirect("/");
  }
);

const makeServer = (port: number) =>
  new Observable((subscriber) => {
    const server = app.listen(port);
    console.log(`Server is running on port ${port}`);

    return () => {
      server.close();
      subscriber.complete();
    };
  });

const server$ = settings$.pipe(
  switchMap((settings) => {
    if (!settings.port) {
      throw new Error("Port is not set in settings.");
    }
    return makeServer(settings.port);
  })
);

const cameraHandler$ = settings$.pipe(
  switchMap((settings) => makeCameraHandler(app, settings))
);

server$.subscribe();
cameraHandler$.subscribe();
