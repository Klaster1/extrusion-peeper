import { spawn as nodeSpawn } from "child_process";
import { distinctUntilChanged, map, type Observable } from "rxjs";
import { isDeepStrictEqual } from "util";
import { createRequire } from "module";
import { Fmp4Parser, type Fmp4Event } from "./mp4.ts";
import type { Settings } from "./settings.ts";

// ffmpeg-static's typings describe an ES default export, but it's a CommonJS string
export const ffmpegPath: string = createRequire(import.meta.url)(
  "ffmpeg-static"
);

export const FRAGMENTED_MP4_FLAGS = [
  "-f",
  "mp4",
  // Every frame is its own fragment, so the browser gets frames as they come
  "-movflags",
  "empty_moov+default_base_moof+frag_every_frame",
];

export type CameraConfig = {
  host: string;
  login: string;
  password: string;
};

export const toCameraConfig = (settings: Settings): CameraConfig | undefined =>
  settings.cameraHost && settings.cameraLogin && settings.cameraPassword
    ? {
        host: settings.cameraHost,
        login: settings.cameraLogin,
        password: settings.cameraPassword,
      }
    : undefined;

/** Emits the camera config only when it changes, so unrelated settings don't restart the stream. */
export const cameraConfigChanges = (settings$: Observable<Settings>) =>
  settings$.pipe(
    map(toCameraConfig),
    distinctUntilChanged<CameraConfig | undefined>(isDeepStrictEqual)
  );

export const buildFfmpegArgs = (config: CameraConfig) => [
  "-hide_banner",
  "-loglevel",
  "error",
  // Tapo cameras send packets without timestamps, so use the arrival time
  "-use_wallclock_as_timestamps",
  "1",
  "-rtsp_transport",
  "tcp",
  // Give up on a camera that stops answering, in microseconds
  "-timeout",
  "10000000",
  "-i",
  `rtsp://${encodeURIComponent(config.login)}:${encodeURIComponent(config.password)}@${config.host}/stream1`,
  "-an",
  "-c:v",
  "copy",
  ...FRAGMENTED_MP4_FLAGS,
  "pipe:1",
];

/** The part of a `ws` WebSocket the stream uses. */
export type StreamClient = {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount: number;
};

type ClientState = { waitingForKeyframe: boolean };

export type CameraStreamOptions = {
  args: string[];
  ffmpegPath?: string;
  spawn?: typeof nodeSpawn;
  /** How long ffmpeg keeps running after the last client leaves, so page reloads are instant. */
  idleTimeoutMs?: number;
  /** A client with more unsent data than this skips ahead to the next keyframe. */
  maxClientBufferBytes?: number;
  /** ffmpeg is restarted when it sends nothing for this long, as a camera can stall without disconnecting. */
  stallTimeoutMs?: number;
};

/**
 * Relays one ffmpeg process to any number of WebSocket clients. Each client
 * gets a JSON message with the MIME type, then the init segment, then media
 * segments starting from the latest keyframe.
 */
export class CameraStream {
  #options: Required<CameraStreamOptions>;
  #clients = new Map<StreamClient, ClientState>();
  #process: ReturnType<typeof nodeSpawn> | undefined;
  #init: Extract<Fmp4Event, { type: "init" }> | undefined;
  #sinceKeyframe: Buffer[] = [];
  #idleTimer: NodeJS.Timeout | undefined;

  constructor(options: CameraStreamOptions) {
    this.#options = {
      ffmpegPath,
      spawn: nodeSpawn,
      idleTimeoutMs: 10_000,
      maxClientBufferBytes: 4 * 1024 * 1024,
      stallTimeoutMs: 10_000,
      ...options,
    };
  }

  /** Adds a client and returns the function that removes it. */
  addClient(client: StreamClient): () => void {
    clearTimeout(this.#idleTimer);
    const state = { waitingForKeyframe: true };
    this.#clients.set(client, state);
    if (this.#init) {
      this.#sendStart(client, state);
    }
    this.#start();
    return () => this.#removeClient(client);
  }

  /** Disconnects every client and stops ffmpeg. */
  stop() {
    clearTimeout(this.#idleTimer);
    this.#closeClients(1012, "Camera settings changed");
    this.#kill();
  }

  #removeClient(client: StreamClient) {
    if (!this.#clients.delete(client) || this.#clients.size) {
      return;
    }
    this.#idleTimer = setTimeout(
      () => this.#kill(),
      this.#options.idleTimeoutMs
    );
  }

  #start() {
    if (this.#process) {
      return;
    }
    const parser = new Fmp4Parser();
    const ffmpeg = this.#options.spawn(
      this.#options.ffmpegPath,
      this.#options.args,
      { windowsHide: true }
    );
    this.#process = ffmpeg;
    // Killing ffmpeg ends the stream like an exit, so the players reconnect
    let stallTimer: NodeJS.Timeout | undefined;
    const watchForStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        console.error("Camera stream stalled, restarting ffmpeg");
        ffmpeg.kill();
      }, this.#options.stallTimeoutMs).unref();
    };
    watchForStall();
    ffmpeg.stdout!.on("data", (chunk: Buffer) => {
      watchForStall();
      try {
        for (const event of parser.push(chunk)) {
          this.#handleEvent(event);
        }
      } catch (error) {
        console.error("Camera stream:", error);
        ffmpeg.kill();
      }
    });
    ffmpeg.stderr!.on("data", (data: Buffer) => {
      console.error(`ffmpeg: ${data.toString().trim()}`);
    });
    const onEnd = (reason: string) => {
      clearTimeout(stallTimer);
      if (this.#process !== ffmpeg) {
        return;
      }
      console.error(`Camera stream ended: ${reason}`);
      this.#process = undefined;
      this.#init = undefined;
      this.#sinceKeyframe = [];
      // The players reconnect, which starts a new ffmpeg
      this.#closeClients(1011, "Camera stream ended");
    };
    ffmpeg.on("error", (error) => onEnd(error.message));
    ffmpeg.on("exit", (code) => onEnd(`ffmpeg exited with code ${code}`));
  }

  #kill() {
    const ffmpeg = this.#process;
    this.#process = undefined;
    this.#init = undefined;
    this.#sinceKeyframe = [];
    ffmpeg?.kill();
  }

  #closeClients(code: number, reason: string) {
    const clients = [...this.#clients.keys()];
    this.#clients.clear();
    for (const client of clients) {
      client.close(code, reason);
    }
  }

  #handleEvent(event: Fmp4Event) {
    if (event.type === "init") {
      this.#init = event;
      this.#sinceKeyframe = [];
      for (const [client, state] of this.#clients) {
        this.#sendStart(client, state);
      }
      return;
    }
    if (event.keyframe) {
      this.#sinceKeyframe = [event.data];
    } else if (this.#sinceKeyframe.length) {
      this.#sinceKeyframe.push(event.data);
    }
    for (const [client, state] of this.#clients) {
      if (state.waitingForKeyframe && !event.keyframe) {
        continue;
      }
      if (client.bufferedAmount > this.#options.maxClientBufferBytes) {
        state.waitingForKeyframe = true;
        continue;
      }
      state.waitingForKeyframe = false;
      client.send(event.data);
    }
  }

  #sendStart(client: StreamClient, state: ClientState) {
    client.send(JSON.stringify({ type: "init", mime: this.#init!.mime }));
    client.send(this.#init!.data);
    for (const segment of this.#sinceKeyframe) {
      client.send(segment);
    }
    state.waitingForKeyframe = !this.#sinceKeyframe.length;
  }
}

/**
 * Hands WebSocket clients to the stream of the current camera config. The
 * route stays registered once, and a config change swaps the stream behind it.
 */
export const createCameraRelay = (
  config$: Observable<CameraConfig | undefined>,
  createStream = (config: CameraConfig) =>
    new CameraStream({ args: buildFfmpegArgs(config) })
) => {
  let stream: CameraStream | undefined;
  const subscription = config$.subscribe((config) => {
    stream?.stop();
    stream = config && createStream(config);
  });
  return {
    connect(
      client: StreamClient & {
        on(event: "close", listener: () => void): unknown;
      }
    ) {
      if (!stream) {
        client.close(1013, "Camera is not configured");
        return;
      }
      client.on("close", stream.addClient(client));
    },
    dispose() {
      subscription.unsubscribe();
      stream?.stop();
      stream = undefined;
    },
  };
};
