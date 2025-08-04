import { Observable, switchMap } from "rxjs";
import { settings$, type Settings } from "./settings.ts";
import rtsp from "rtsp-relay";
import type expressWs from "express-ws";

type Proxy = ReturnType<typeof rtsp>["proxy"];

let proxy: Proxy;

export const makeCameraHandler = (
  app: expressWs.Application,
  settings: Settings
) => {
  if (!proxy) {
    proxy = rtsp(app).proxy;
  }
  return new Observable(() => {
    const handler = proxy({
      url: `rtsp://${settings.cameraLogin}:${settings.cameraPassword}@${settings.cameraHost}/stream1`,
      verbose: false,
      additionalFlags: settings.ffmpegFlags ?? [],
    });
    app.ws("/api/stream", handler);
    return () => {
      app._router.stack = app._router.stack.filter(
        (r: any) => r.route?.path !== "/api/stream"
      );
    };
  });
};
