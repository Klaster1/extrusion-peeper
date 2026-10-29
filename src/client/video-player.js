import { connectSocket } from "./socket.js";

// How far playback may fall behind the newest frame before it jumps ahead
const MAX_LATENCY_S = 1.5;
// Where playback lands after a jump, just behind the newest frame
const LIVE_EDGE_OFFSET_S = 0.1;
// How much already played video to keep in the buffer
const KEEP_BEHIND_S = 10;

/**
 * Where to move playback to stay near the newest frame, or undefined to leave
 * it be. Handles both falling behind and sitting in a gap before the buffer.
 *
 * @param {TimeRanges} buffered
 * @param {number} currentTime
 */
export function liveSeekTarget(buffered, currentTime) {
  if (!buffered.length) {
    return;
  }
  const start = buffered.start(buffered.length - 1);
  const end = buffered.end(buffered.length - 1);
  if (currentTime < start || end - currentTime > MAX_LATENCY_S) {
    return Math.max(start, end - LIVE_EDGE_OFFSET_S);
  }
}

/**
 * Appends segments to a SourceBuffer one at a time, as it only takes one
 * operation at a time, and drops played video so the buffer doesn't fill up.
 */
export class SegmentQueue {
  /** @type {ArrayBuffer[]} */
  #segments = [];
  /** @type {SourceBuffer | undefined} */
  #sourceBuffer;
  #getCurrentTime;
  #onAppended;

  /**
   * @param {{ getCurrentTime: () => number; onAppended: () => void }} options
   */
  constructor({ getCurrentTime, onAppended }) {
    this.#getCurrentTime = getCurrentTime;
    this.#onAppended = onAppended;
  }

  /** @param {SourceBuffer} sourceBuffer */
  attach(sourceBuffer) {
    this.#sourceBuffer = sourceBuffer;
    sourceBuffer.addEventListener("updateend", () => {
      this.#onAppended();
      this.#drain();
    });
    this.#drain();
  }

  /** @param {ArrayBuffer} segment */
  push(segment) {
    this.#segments.push(segment);
    this.#drain();
  }

  #drain() {
    const sourceBuffer = this.#sourceBuffer;
    if (!sourceBuffer || sourceBuffer.updating || !this.#segments.length) {
      return;
    }
    const removeUntil = this.#getCurrentTime() - KEEP_BEHIND_S;
    if (
      sourceBuffer.buffered.length &&
      sourceBuffer.buffered.start(0) < removeUntil - KEEP_BEHIND_S
    ) {
      sourceBuffer.remove(0, removeUntil);
      return;
    }
    sourceBuffer.appendBuffer(
      /** @type {ArrayBuffer} */ (this.#segments.shift())
    );
  }
}

/**
 * Plays the camera stream in a video element. The server sends the MIME type
 * as JSON, then the init segment and media segments as binary messages.
 *
 * @param {HTMLVideoElement} video
 * @param {string} url
 * @param {{
 *   WebSocketImpl?: typeof WebSocket;
 *   MediaSourceImpl?: typeof MediaSource;
 *   createObjectURL?: (source: MediaSource) => string;
 *   revokeObjectURL?: (url: string) => void;
 * }} [options]
 */
export function playStream(
  video,
  url,
  {
    WebSocketImpl = WebSocket,
    MediaSourceImpl = MediaSource,
    createObjectURL = (source) => URL.createObjectURL(source),
    revokeObjectURL = (url) => URL.revokeObjectURL(url),
  } = {}
) {
  /** @type {SegmentQueue | undefined} */
  let queue;
  /** @type {WebSocket | undefined} */
  let socket;

  const keepLive = () => {
    const target = liveSeekTarget(video.buffered, video.currentTime);
    if (target !== undefined) {
      video.currentTime = target;
    }
    if (video.paused) {
      // Muted video may autoplay, and a failure here is retried on the next segment
      video.play().catch(() => {});
    }
  };

  /** @param {string} mime */
  const start = (mime) => {
    if (video.src) {
      revokeObjectURL(video.src);
    }
    const mediaSource = new MediaSourceImpl();
    const segmentQueue = new SegmentQueue({
      getCurrentTime: () => video.currentTime,
      onAppended: keepLive,
    });
    mediaSource.addEventListener(
      "sourceopen",
      () => {
        try {
          const sourceBuffer = mediaSource.addSourceBuffer(mime);
          sourceBuffer.addEventListener("error", () => socket?.close());
          segmentQueue.attach(sourceBuffer);
        } catch (error) {
          console.error(`Can't play ${mime}:`, error);
        }
      },
      { once: true }
    );
    video.src = createObjectURL(mediaSource);
    return segmentQueue;
  };

  return connectSocket(url, {
    WebSocketImpl,
    binaryType: "arraybuffer",
    onOpen: (openedSocket) => {
      socket = openedSocket;
      queue = undefined;
    },
    onMessage: (data) => {
      if (typeof data === "string") {
        /** @type {import("../protocol.ts").StreamInitMessage} */
        const message = JSON.parse(data);
        if (message.type === "init") {
          queue = start(message.mime);
        }
        return;
      }
      queue?.push(data);
    },
  });
}
