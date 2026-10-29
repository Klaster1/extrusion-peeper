import express, { type Request, type Response } from "express";
import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import { join } from "path";
import { WebSocketServer, type WebSocket } from "ws";
import * as z from "zod/v4";
import {
  distinctUntilChanged,
  map,
  Observable,
  switchMap,
  type Subscription,
} from "rxjs";
import type { Settings } from "./settings.ts";
import type { StreamClient } from "./camera.ts";
import {
  SettingsFormSchema,
  type CameraSettingsMessage,
  type SocketMessages,
} from "./protocol.ts";

export type AppDependencies = {
  settings$: Observable<Settings>;
  temperature$: Observable<SocketMessages["/api/temperature"]>;
  sensorOptions$: Observable<SocketMessages["/api/sensors"]>;
  cameraRelay: { connect(client: StreamClient & Pick<WebSocket, "on">): void };
  updateSettings: (updates: Partial<Settings>) => Promise<unknown>;
};

type SocketHandler = (ws: WebSocket) => void;

/** Sends every value as JSON until the socket closes. */
export const sendUpdates = <T>(ws: WebSocket, source$: Observable<T>) => {
  const subscription: Subscription = source$.subscribe({
    next: (value) => ws.send(JSON.stringify(value)),
    error: (error) => {
      console.error("WebSocket update stream failed:", error);
      ws.close(1011);
    },
  });
  ws.on("close", () => subscription.unsubscribe());
};

const ROOT = join(import.meta.dirname, "..");

export const createApp = ({
  settings$,
  temperature$,
  sensorOptions$,
  cameraRelay,
  updateSettings,
}: AppDependencies) => {
  const app = express();

  app.use("/vendor/dseg", express.static(join(ROOT, "node_modules", "dseg")));
  app.use("/client", express.static(join(import.meta.dirname, "client")));

  app.get("/", (_req, res) => {
    res.sendFile(join(import.meta.dirname, "index.html"));
  });

  app.post(
    "/api/settings",
    express.urlencoded(),
    async (req: Request<{}, string, unknown>, res: Response<string>) => {
      const form = SettingsFormSchema.safeParse(req.body ?? {});
      if (!form.success) {
        return res.status(400).send(z.prettifyError(form.error));
      }
      const { sensorDeviceId, cameraHost, cameraLogin, cameraPassword } =
        form.data;
      const cameraSettings: Partial<Settings> =
        cameraHost && cameraLogin && cameraPassword
          ? { cameraHost, cameraLogin, cameraPassword }
          : {};
      try {
        await updateSettings({
          temperatureSensorDeviceId: sensorDeviceId,
          ...cameraSettings,
        });
      } catch (error) {
        console.error("Failed to save settings:", error);
        return res.status(500).send("Failed to save settings.");
      }
      res.redirect("/");
    }
  );

  // Each JSON route must send the message type the page expects
  const jsonRoutes: {
    [Path in keyof SocketMessages]: Observable<SocketMessages[Path]>;
  } = {
    "/api/temperature": temperature$,
    "/api/sensors": sensorOptions$,
    "/api/settings": settings$.pipe(
      map(
        (settings): CameraSettingsMessage => ({
          cameraHost: settings.cameraHost,
          cameraLogin: settings.cameraLogin,
        })
      )
    ),
  };
  const socketRoutes: Record<string, SocketHandler> = {
    "/api/stream": (ws) => cameraRelay.connect(ws),
    ...Object.fromEntries(
      Object.entries(jsonRoutes).map(
        ([path, source$]): [string, SocketHandler] => [
          path,
          (ws) => sendUpdates<unknown>(ws, source$),
        ]
      )
    ),
  };

  /** Starts the HTTP server with the WebSocket routes on the given port. */
  const listen = (port: number) => {
    const server = app.listen(port);
    const closeSockets = attachSockets(server, socketRoutes);
    return {
      server,
      close() {
        closeSockets();
        server.close();
      },
    };
  };

  return { app, listen };
};

/** Routes WebSocket upgrades by path, and returns a function that closes them all. */
const attachSockets = (
  server: Server,
  routes: Record<string, SocketHandler>
) => {
  const sockets = new WebSocketServer({ noServer: true });
  server.on(
    "upgrade",
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const { pathname } = new URL(request.url ?? "/", "http://localhost");
      const handler = Object.hasOwn(routes, pathname)
        ? routes[pathname]
        : undefined;
      if (!handler) {
        socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
        return;
      }
      sockets.handleUpgrade(request, socket, head, handler);
    }
  );
  return () => {
    for (const client of sockets.clients) {
      client.terminate();
    }
    sockets.close();
  };
};

/** Listens on the configured port, restarting the server only when the port changes. */
export const serveOnPort = (
  settings$: Observable<Settings>,
  listen: (port: number) => { close(): void }
) =>
  settings$.pipe(
    map((settings) => settings.port),
    distinctUntilChanged(),
    switchMap(
      (port) =>
        new Observable<number>((subscriber) => {
          if (!port) {
            subscriber.error(new Error("Port is not set in settings."));
            return;
          }
          const server = listen(port);
          subscriber.next(port);
          return () => server.close();
        })
    )
  );
