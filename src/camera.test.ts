import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { Subject } from "rxjs";
import {
  buildFfmpegArgs,
  CameraStream,
  cameraConfigChanges,
  createCameraRelay,
  toCameraConfig,
  type CameraConfig,
  type CameraStreamOptions,
  type StreamClient,
} from "./camera.ts";
import { DEFAULT_SETTINGS, type Settings } from "./settings.ts";
import { Fmp4Parser } from "./mp4.ts";
import {
  chunk,
  makeTestVideo,
  testVideoArgs,
  TEST_VIDEO_GOP,
  waitFor,
} from "./test-helpers.ts";

const video = makeTestVideo({ seconds: 2 });
const [init, ...segments] = new Fmp4Parser().push(video);

class FakeClient implements StreamClient {
  sent: (string | Buffer)[] = [];
  bufferedAmount = 0;
  closed: { code?: number; reason?: string } | undefined;
  listeners: (() => void)[] = [];
  send(data: string | Buffer) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  on(_event: "close", listener: () => void) {
    this.listeners.push(listener);
  }
  get binary() {
    return this.sent.filter((data) => typeof data !== "string") as Buffer[];
  }
}

class FakeProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  kill() {
    this.killed = true;
    this.emit("exit", null);
    return true;
  }
  /** Writes the video up to the end of the given segment, in pipe-sized chunks. */
  writeUntilSegment(index: number) {
    const end =
      init.data.length +
      segments.slice(0, index + 1).reduce((sum, s) => sum + s.data.length, 0);
    for (const part of chunk(video.subarray(this.written, end), 1000)) {
      this.stdout.emit("data", part);
    }
    this.written = end;
  }
  written = 0;
}

const makeStream = (
  options: Omit<CameraStreamOptions, "args" | "spawn"> = {}
) => {
  const processes: FakeProcess[] = [];
  const spawn = mock.fn(() => {
    const process = new FakeProcess();
    processes.push(process);
    return process;
  });
  const stream = new CameraStream({
    args: ["fake"],
    spawn: spawn as any,
    ...options,
  });
  return { stream, spawn, processes };
};

const config: CameraConfig = {
  host: "192.168.1.15",
  login: "admin",
  password: "secret",
};

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

describe("buildFfmpegArgs", () => {
  it("escapes credentials in the RTSP URL", () => {
    const args = buildFfmpegArgs({ ...config, password: "p@ss:w/rd" });

    assert.ok(
      args.includes("rtsp://admin:p%40ss%3Aw%2Frd@192.168.1.15/stream1")
    );
  });

  it("copies the video into fragmented MP4 on stdout", () => {
    const args = buildFfmpegArgs(config);

    assert.equal(args[args.indexOf("-c:v") + 1], "copy");
    assert.ok(args.includes("-an"));
    assert.equal(args[args.indexOf("-f") + 1], "mp4");
    assert.equal(args.at(-1), "pipe:1");
  });
});

describe("cameraConfigChanges", () => {
  const settings = (overrides: Partial<Settings>): Settings => ({
    ...DEFAULT_SETTINGS,
    cameraHost: config.host,
    cameraLogin: config.login,
    cameraPassword: config.password,
    ...overrides,
  });

  it("is undefined until host, login and password are all set", () => {
    assert.equal(toCameraConfig(settings({ cameraPassword: null })), undefined);
    assert.deepEqual(toCameraConfig(settings({})), config);
  });

  it("ignores changes to settings unrelated to the camera", () => {
    const settings$ = new Subject<Settings>();
    const emitted: unknown[] = [];
    cameraConfigChanges(settings$).subscribe((value) => emitted.push(value));

    settings$.next(settings({}));
    settings$.next(settings({ port: 1234, temperatureSensorDeviceId: "x" }));
    settings$.next(settings({ cameraHost: "192.168.1.16" }));

    assert.equal(emitted.length, 2);
  });
});

describe("CameraStream", () => {
  it("starts one ffmpeg for all clients and sends the MIME type, init segment and frames", () => {
    const { stream, spawn, processes } = makeStream();
    const first = new FakeClient();
    const second = new FakeClient();

    stream.addClient(first);
    stream.addClient(second);
    processes[0].writeUntilSegment(2);

    assert.equal(spawn.mock.callCount(), 1);
    for (const client of [first, second]) {
      assert.deepEqual(JSON.parse(client.sent[0] as string), {
        type: "init",
        mime: (init as any).mime,
      });
      assert.deepEqual(client.binary, [
        init.data,
        ...segments.slice(0, 3).map((s) => s.data),
      ]);
    }
  });

  it("starts a late client from the latest keyframe", () => {
    const { stream, processes } = makeStream();
    stream.addClient(new FakeClient());
    processes[0].writeUntilSegment(TEST_VIDEO_GOP + 1);

    const late = new FakeClient();
    stream.addClient(late);

    assert.deepEqual(late.binary, [
      init.data,
      segments[TEST_VIDEO_GOP].data,
      segments[TEST_VIDEO_GOP + 1].data,
    ]);
  });

  it("makes a client that falls behind skip ahead to the next keyframe", () => {
    const { stream, processes } = makeStream({ maxClientBufferBytes: 100 });
    const slow = new FakeClient();
    stream.addClient(slow);
    processes[0].writeUntilSegment(0);

    slow.bufferedAmount = 1000;
    processes[0].writeUntilSegment(1);
    slow.bufferedAmount = 0;
    processes[0].writeUntilSegment(TEST_VIDEO_GOP);

    assert.deepEqual(slow.binary, [
      init.data,
      segments[0].data,
      segments[TEST_VIDEO_GOP].data,
    ]);
  });

  it("disconnects the clients when ffmpeg exits, so they reconnect", () => {
    const { stream, processes } = makeStream();
    const client = new FakeClient();
    stream.addClient(client);

    processes[0].emit("exit", 1);

    assert.equal(client.closed?.code, 1011);
  });

  it("keeps ffmpeg running for a while after the last client leaves", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const { stream, spawn, processes } = makeStream({ idleTimeoutMs: 1000 });

    const remove = stream.addClient(new FakeClient());
    remove();
    mock.timers.tick(500);
    stream.addClient(new FakeClient())();
    mock.timers.tick(999);
    assert.equal(processes[0].killed, false);

    mock.timers.tick(1);
    assert.equal(processes[0].killed, true);
    assert.equal(spawn.mock.callCount(), 1);
  });

  it("restarts ffmpeg when it stops sending video", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const { stream, processes } = makeStream({ stallTimeoutMs: 1000 });
    const client = new FakeClient();
    stream.addClient(client);
    mock.method(console, "error", () => {});

    mock.timers.tick(900);
    processes[0].writeUntilSegment(0);
    mock.timers.tick(900);
    assert.equal(processes[0].killed, false);

    mock.timers.tick(100);
    assert.equal(processes[0].killed, true);
    assert.equal(client.closed?.code, 1011);
  });

  it("closes the clients and ffmpeg when stopped", () => {
    const { stream, processes } = makeStream();
    const client = new FakeClient();
    stream.addClient(client);

    stream.stop();

    assert.equal(client.closed?.code, 1012);
    assert.equal(processes[0].killed, true);
  });

  it("relays a real ffmpeg process", async () => {
    const stream = new CameraStream({
      args: testVideoArgs({ seconds: 5, realtime: true }),
    });
    const client = new FakeClient();
    stream.addClient(client);

    try {
      await waitFor(() => client.binary.length >= 3);
      assert.match(client.sent[0] as string, /avc1/);
      assert.equal(client.binary[0].toString("latin1", 4, 8), "ftyp");
      assert.equal(client.binary[1].toString("latin1", 4, 8), "moof");
    } finally {
      stream.stop();
    }
  });
});

describe("createCameraRelay", () => {
  const fakeStream = () => ({
    addClient: mock.fn(() => () => {}),
    stop: mock.fn(),
  });

  it("turns clients away until the camera is configured", () => {
    const relay = createCameraRelay(new Subject());
    const client = new FakeClient();

    relay.connect(client);

    assert.equal(client.closed?.code, 1013);
  });

  it("connects clients to the stream of the current config and stops the old one on change", () => {
    const config$ = new Subject<CameraConfig | undefined>();
    const streams: ReturnType<typeof fakeStream>[] = [];
    const relay = createCameraRelay(config$, () => {
      const stream = fakeStream();
      streams.push(stream);
      return stream as unknown as CameraStream;
    });

    config$.next(config);
    const client = new FakeClient();
    relay.connect(client);
    config$.next({ ...config, host: "192.168.1.16" });
    relay.connect(new FakeClient());

    assert.equal(streams[0].addClient.mock.callCount(), 1);
    assert.equal(streams[0].stop.mock.callCount(), 1);
    assert.equal(streams[1].addClient.mock.callCount(), 1);
    assert.equal(client.listeners.length, 1);
  });
});
