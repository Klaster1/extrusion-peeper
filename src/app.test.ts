import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "net";
import { BehaviorSubject, Subject } from "rxjs";
import { createApp, serveOnPort, type AppDependencies } from "./app.ts";
import { DEFAULT_SETTINGS, type Settings } from "./settings.ts";
import type { SocketMessages, TemperatureReading } from "./protocol.ts";
import { waitFor } from "./test-helpers.ts";

const openSocket = async (url: string) => {
  const socket = new WebSocket(url);
  const messages: string[] = [];
  socket.addEventListener("message", (event) => messages.push(event.data));
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  return { socket, messages };
};

describe("createApp", () => {
  const temperature$ = new Subject<TemperatureReading | null>();
  const sensorOptions$ = new Subject<SocketMessages["/api/sensors"]>();
  const settings$ = new BehaviorSubject<Settings>({
    ...DEFAULT_SETTINGS,
    cameraHost: "192.168.1.15",
    cameraPassword: "secret",
  });
  const connect = mock.fn((client: { close(): void }) => client.close());
  const updateSettings = mock.fn<AppDependencies["updateSettings"]>(
    async () => {}
  );
  let close: () => void;
  let base: string;

  before(async () => {
    const { listen } = createApp({
      settings$,
      temperature$,
      sensorOptions$,
      cameraRelay: { connect },
      updateSettings,
    });
    const started = listen(0);
    close = started.close;
    await new Promise((resolve) => started.server.once("listening", resolve));
    base = `127.0.0.1:${(started.server.address() as AddressInfo).port}`;
  });

  after(() => close());

  it("stops sending updates once the socket closes", async () => {
    const { socket, messages } = await openSocket(
      `ws://${base}/api/temperature`
    );
    await waitFor(() => temperature$.observed);

    temperature$.next({ temperature: 25.5, online: false, lowBattery: true });
    temperature$.next(null);
    await waitFor(() => messages.length === 2);
    socket.close();

    await waitFor(() => !temperature$.observed);
    assert.deepEqual(
      messages.map((message) => JSON.parse(message)),
      [{ temperature: 25.5, online: false, lowBattery: true }, null]
    );
  });

  it("sends the sensor options", async () => {
    const options = [
      { id: "a", name: "A", online: true, lowBattery: false, selected: true },
    ];
    const { socket, messages } = await openSocket(`ws://${base}/api/sensors`);
    await waitFor(() => sensorOptions$.observed);

    sensorOptions$.next(options);
    await waitFor(() => messages.length === 1);
    socket.close();

    assert.deepEqual(JSON.parse(messages[0]), options);
  });

  it("sends the camera host and login, but not the password", async () => {
    const { socket, messages } = await openSocket(`ws://${base}/api/settings`);
    await waitFor(() => messages.length === 1);
    socket.close();

    assert.deepEqual(JSON.parse(messages[0]), {
      cameraHost: "192.168.1.15",
      cameraLogin: null,
    });
  });

  it("hands stream sockets to the camera relay", async () => {
    const socket = new WebSocket(`ws://${base}/api/stream`);
    await new Promise((resolve) => socket.addEventListener("close", resolve));

    assert.equal(connect.mock.callCount(), 1);
  });

  it("refuses WebSockets on unknown paths", async () => {
    await assert.rejects(openSocket(`ws://${base}/api/nope`));
  });

  it("serves the client scripts and the LCD font, but not the rest of node_modules", async () => {
    const script = await fetch(`http://${base}/client/video-player.js`);
    const font = await fetch(`http://${base}/vendor/dseg/css/dseg.css`);
    const other = await fetch(`http://${base}/node_modules/rxjs/package.json`);

    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type")!, /javascript/);
    assert.equal(font.status, 200);
    assert.equal(other.status, 404);
  });

  it("saves the settings and redirects home", async () => {
    const response = await fetch(`http://${base}/api/settings`, {
      method: "POST",
      body: new URLSearchParams({ sensorDeviceId: "sensor", cameraHost: "" }),
      redirect: "manual",
    });

    assert.equal(response.status, 302);
    assert.deepEqual(updateSettings.mock.calls.at(-1)!.arguments, [
      { temperatureSensorDeviceId: "sensor" },
    ]);
  });

  it("saves the camera only when host, login and password are all given", async () => {
    await fetch(`http://${base}/api/settings`, {
      method: "POST",
      body: new URLSearchParams({
        sensorDeviceId: "sensor",
        cameraHost: "192.168.1.16",
        cameraLogin: "admin",
        cameraPassword: "secret",
      }),
      redirect: "manual",
    });

    assert.deepEqual(updateSettings.mock.calls.at(-1)!.arguments, [
      {
        temperatureSensorDeviceId: "sensor",
        cameraHost: "192.168.1.16",
        cameraLogin: "admin",
        cameraPassword: "secret",
      },
    ]);
  });

  it("rejects a form without a sensor", async () => {
    const calls = updateSettings.mock.callCount();

    const response = await fetch(`http://${base}/api/settings`, {
      method: "POST",
      body: new URLSearchParams({ cameraHost: "192.168.1.16" }),
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /Sensor ID is required/);
    assert.equal(updateSettings.mock.callCount(), calls);
  });

  it("answers with an error when the settings can't be saved", async () => {
    mock.method(console, "error", () => {});
    updateSettings.mock.mockImplementationOnce(async () => {
      throw new Error("Disk full");
    });

    const response = await fetch(`http://${base}/api/settings`, {
      method: "POST",
      body: new URLSearchParams({ sensorDeviceId: "sensor" }),
    });

    assert.equal(response.status, 500);
  });
});

describe("listen", () => {
  it("closes open WebSockets when the server closes", async () => {
    const { listen } = createApp({
      settings$: new Subject(),
      temperature$: new Subject(),
      sensorOptions$: new Subject(),
      cameraRelay: { connect: () => {} },
      updateSettings: async () => {},
    });
    const { server, close } = listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const { socket } = await openSocket(`ws://127.0.0.1:${port}/api/sensors`);
    const closed = new Promise((resolve) =>
      socket.addEventListener("close", resolve)
    );

    close();

    await closed;
  });
});

describe("serveOnPort", () => {
  it("restarts the server only when the port changes", () => {
    const settings$ = new Subject<Settings>();
    const servers: { port: number; close: ReturnType<typeof mock.fn> }[] = [];
    const listen = (port: number) => {
      const server = { port, close: mock.fn() };
      servers.push(server);
      return server;
    };
    serveOnPort(settings$, listen).subscribe();

    settings$.next({ ...DEFAULT_SETTINGS, port: 2024 });
    settings$.next({ ...DEFAULT_SETTINGS, port: 2024, cameraHost: "host" });
    settings$.next({ ...DEFAULT_SETTINGS, port: 2025 });

    assert.deepEqual(
      servers.map((server) => server.port),
      [2024, 2025]
    );
    assert.equal(servers[0].close.mock.callCount(), 1);
  });
});
