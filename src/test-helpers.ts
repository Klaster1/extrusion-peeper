import { execFileSync } from "child_process";
import { ffmpegPath, FRAGMENTED_MP4_FLAGS } from "./camera.ts";

export const TEST_VIDEO_FPS = 10;
export const TEST_VIDEO_GOP = 5;

/** ffmpeg arguments for a tiny H.264 test pattern in the same fragmented MP4 format as the camera stream. */
export const testVideoArgs = ({ seconds = 1, realtime = false } = {}) => [
  "-hide_banner",
  "-loglevel",
  "error",
  ...(realtime ? ["-re"] : []),
  "-f",
  "lavfi",
  "-i",
  `testsrc=size=64x48:rate=${TEST_VIDEO_FPS}:duration=${seconds}`,
  "-c:v",
  "libx264",
  "-g",
  String(TEST_VIDEO_GOP),
  "-pix_fmt",
  "yuv420p",
  ...FRAGMENTED_MP4_FLAGS,
  "pipe:1",
];

export const makeTestVideo = (options?: { seconds?: number }) =>
  execFileSync(ffmpegPath, testVideoArgs(options));

/** Splits a buffer into chunks of the given size, like a pipe would deliver it. */
export const chunk = (buf: Buffer, size: number) => {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buf.length; offset += size) {
    chunks.push(buf.subarray(offset, offset + size));
  }
  return chunks;
};

/** Waits until the condition holds, polling every few milliseconds. */
export const waitFor = async (condition: () => boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
