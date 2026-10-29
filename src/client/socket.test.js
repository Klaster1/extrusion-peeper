import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { connectJsonSocket, connectSocket, socketUrl } from "./socket.js";
import { FakeWebSocket } from "./fakes.js";

describe("connectSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    mock.timers.enable({ apis: ["setTimeout"] });
  });

  afterEach(() => mock.timers.reset());

  it("passes messages on and sets the binary type", () => {
    const messages = [];
    connectSocket("ws://host/api", {
      onMessage: (data) => messages.push(data),
      binaryType: "arraybuffer",
      WebSocketImpl: FakeWebSocket,
    });
    const [socket] = FakeWebSocket.instances;

    socket.receive("25");

    assert.equal(socket.url, "ws://host/api");
    assert.equal(socket.binaryType, "arraybuffer");
    assert.deepEqual(messages, ["25"]);
  });

  it("reconnects after the delay when the socket closes", () => {
    const opened = [];
    connectSocket("ws://host/api", {
      onMessage: () => {},
      onOpen: (socket) => opened.push(socket),
      reconnectDelayMs: 1000,
      WebSocketImpl: FakeWebSocket,
    });

    FakeWebSocket.instances[0].close();
    mock.timers.tick(999);
    assert.equal(FakeWebSocket.instances.length, 1);
    mock.timers.tick(1);
    assert.equal(FakeWebSocket.instances.length, 2);

    FakeWebSocket.instances[1].open();
    assert.deepEqual(opened, [FakeWebSocket.instances[1]]);
  });

  it("stops reconnecting once closed by the page", () => {
    const connection = connectSocket("ws://host/api", {
      onMessage: () => {},
      WebSocketImpl: FakeWebSocket,
    });

    connection.close();
    mock.timers.tick(10_000);

    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(FakeWebSocket.instances[0].closed, true);
  });
});

describe("connectJsonSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  it("connects to the route on the page's host and parses messages", () => {
    const messages = [];
    connectJsonSocket("/api/temperature", (message) => messages.push(message), {
      location: { protocol: "http:", host: "printer:2024" },
      WebSocketImpl: FakeWebSocket,
    });
    const [socket] = FakeWebSocket.instances;

    socket.receive('{"temperature":32.6,"online":true,"lowBattery":false}');
    socket.receive("null");

    assert.equal(socket.url, "ws://printer:2024/api/temperature");
    assert.deepEqual(messages, [
      { temperature: 32.6, online: true, lowBattery: false },
      null,
    ]);
  });

  it("uses secure WebSockets on HTTPS pages", () => {
    assert.equal(
      socketUrl("/api/stream", { protocol: "https:", host: "printer" }),
      "wss://printer/api/stream"
    );
  });
});
