import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { liveSeekTarget, playStream, SegmentQueue } from "./video-player.js";
import {
  FakeMediaSource,
  FakeSourceBuffer,
  FakeWebSocket,
  fakeVideo,
  timeRanges,
} from "./fakes.js";

describe("liveSeekTarget", () => {
  it("leaves playback alone when it's near the newest frame", () => {
    assert.equal(liveSeekTarget(timeRanges([10, 20]), 19), undefined);
  });

  it("jumps near the newest frame when playback falls behind", () => {
    assert.equal(liveSeekTarget(timeRanges([10, 20]), 15), 19.9);
  });

  it("jumps into the buffer when playback sits before it", () => {
    assert.equal(liveSeekTarget(timeRanges([100, 100.05]), 0), 100);
  });

  it("uses the newest range when there are gaps", () => {
    assert.equal(liveSeekTarget(timeRanges([0, 5], [30, 31]), 4), 30.9);
  });

  it("does nothing without buffered video", () => {
    assert.equal(liveSeekTarget(timeRanges(), 0), undefined);
  });
});

describe("SegmentQueue", () => {
  const makeQueue = (currentTime = 0) => {
    const appended = [];
    const queue = new SegmentQueue({
      getCurrentTime: () => currentTime,
      onAppended: () => appended.push(true),
    });
    return { queue, appended };
  };

  it("holds segments until a source buffer is attached, then appends one at a time", () => {
    const { queue, appended } = makeQueue();
    const sourceBuffer = new FakeSourceBuffer();

    queue.push("a");
    queue.push("b");
    queue.attach(sourceBuffer);
    assert.deepEqual(sourceBuffer.appended, ["a"]);

    sourceBuffer.finish();
    assert.deepEqual(sourceBuffer.appended, ["a", "b"]);
    assert.equal(appended.length, 1);
  });

  it("removes video played long ago before appending more", () => {
    const { queue } = makeQueue(100);
    const sourceBuffer = new FakeSourceBuffer();
    sourceBuffer.buffered = timeRanges([0, 100]);
    queue.attach(sourceBuffer);

    queue.push("a");
    assert.deepEqual(sourceBuffer.removed, [[0, 90]]);
    assert.deepEqual(sourceBuffer.appended, []);

    sourceBuffer.buffered = timeRanges([90, 100]);
    sourceBuffer.finish();
    assert.deepEqual(sourceBuffer.appended, ["a"]);
  });
});

describe("playStream", () => {
  const initSegment = new ArrayBuffer(8);
  const frame = new ArrayBuffer(4);
  let video;
  let revoked;
  let objectUrls;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeMediaSource.instances = [];
    video = fakeVideo();
    revoked = [];
    objectUrls = 0;
    playStream(video, "ws://host/api/stream", {
      WebSocketImpl: FakeWebSocket,
      MediaSourceImpl: FakeMediaSource,
      createObjectURL: () => `blob:${++objectUrls}`,
      revokeObjectURL: (url) => revoked.push(url),
    });
  });

  const init = (socket, mime = 'video/mp4; codecs="avc1.640028"') => {
    socket.open();
    socket.receive(JSON.stringify({ type: "init", mime }));
    const mediaSource = FakeMediaSource.instances.at(-1);
    mediaSource.open();
    return mediaSource.sourceBuffers[0];
  };

  it("appends the init segment and frames to a source buffer of the sent MIME type", () => {
    const socket = FakeWebSocket.instances[0];
    const sourceBuffer = init(socket);

    socket.receive(initSegment);
    sourceBuffer.finish();
    socket.receive(frame);

    assert.equal(socket.binaryType, "arraybuffer");
    assert.equal(video.src, "blob:1");
    assert.equal(sourceBuffer.mime, 'video/mp4; codecs="avc1.640028"');
    assert.deepEqual(sourceBuffer.appended, [initSegment, frame]);
  });

  it("starts playing and keeps up with the newest frame", () => {
    const sourceBuffer = init(FakeWebSocket.instances[0]);
    FakeWebSocket.instances[0].receive(frame);
    video.buffered = timeRanges([50, 60]);

    sourceBuffer.finish();

    assert.equal(video.paused, false);
    assert.equal(video.currentTime, 59.9);
  });

  it("starts over with a new media source after reconnecting", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    init(FakeWebSocket.instances[0]);

    FakeWebSocket.instances[0].close();
    t.mock.timers.tick(2000);
    init(FakeWebSocket.instances[1]);

    assert.equal(FakeMediaSource.instances.length, 2);
    assert.deepEqual(revoked, ["blob:1"]);
    assert.equal(video.src, "blob:2");
  });

  it("reconnects when the source buffer fails", () => {
    const socket = FakeWebSocket.instances[0];
    const sourceBuffer = init(socket);

    sourceBuffer.dispatchEvent(new Event("error"));

    assert.equal(socket.closed, true);
  });
});
