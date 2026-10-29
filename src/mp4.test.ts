import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Fmp4Parser,
  isKeyframe,
  readAvcConfig,
  UnsupportedCodecError,
  type Fmp4Event,
} from "./mp4.ts";
import {
  chunk,
  makeTestVideo,
  TEST_VIDEO_FPS,
  TEST_VIDEO_GOP,
} from "./test-helpers.ts";

const video = makeTestVideo({ seconds: 2 });

const box = (type: string, payload: Buffer) => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
};

const nal = (header: number, lengthSize = 4) => {
  const length = Buffer.alloc(lengthSize);
  length.writeUIntBE(2, 0, lengthSize);
  return Buffer.concat([length, Buffer.from([header, 0x88])]);
};

const parseAll = (chunks: Buffer[]) => {
  const parser = new Fmp4Parser();
  return chunks.flatMap((part) => parser.push(part));
};

describe("Fmp4Parser", () => {
  it("emits the init segment with an H.264 MIME type, then one segment per frame", () => {
    const [init, ...segments] = parseAll([video]);

    assert.equal(init.type, "init");
    assert.match(
      (init as Extract<Fmp4Event, { type: "init" }>).mime,
      /^video\/mp4; codecs="avc1\.[0-9a-f]{6}"$/
    );
    assert.equal(init.data.toString("latin1", 4, 8), "ftyp");
    assert.equal(segments.length, 2 * TEST_VIDEO_FPS);
    for (const segment of segments) {
      assert.equal(segment.type, "segment");
      assert.equal(segment.data.toString("latin1", 4, 8), "moof");
    }
  });

  it("flags the segments that start a group of pictures as keyframes", () => {
    const segments = parseAll([video]).slice(1) as Extract<
      Fmp4Event,
      { type: "segment" }
    >[];

    const keyframes = segments.flatMap((segment, index) =>
      segment.keyframe ? [index] : []
    );
    assert.deepEqual(
      keyframes,
      segments.map((_, index) => index).filter((i) => i % TEST_VIDEO_GOP === 0)
    );
  });

  it("parses the same events however the stream is chunked", () => {
    const whole = parseAll([video]);

    for (const size of [1, 7, 4096]) {
      const events = parseAll(chunk(video, size));
      assert.deepEqual(events, whole, `chunk size ${size}`);
    }
  });

  it("reads boxes with a 64-bit size", () => {
    const large = Buffer.alloc(24);
    large.writeUInt32BE(1);
    large.write("free", 4, "latin1");
    large.writeBigUInt64BE(24n, 8);

    const events = parseAll([large, video]);

    assert.deepEqual(events, parseAll([video]));
  });
});

describe("readAvcConfig", () => {
  const moovOf = (buf: Buffer) => {
    for (let offset = 0; offset < buf.length; ) {
      const size = buf.readUInt32BE(offset);
      if (buf.toString("latin1", offset + 4, offset + 8) === "moov") {
        return Buffer.from(buf.subarray(offset, offset + size));
      }
      offset += size;
    }
    throw new Error("No moov");
  };

  it("reads the codec string and NAL length size", () => {
    const config = readAvcConfig(moovOf(video));

    assert.match(config.codec, /^avc1\.64[0-9a-f]{4}$/);
    assert.equal(config.nalLengthSize, 4);
  });

  it("rejects codecs other than H.264", () => {
    const moov = moovOf(video);
    const entry = moov.indexOf("avc1", 0, "latin1");
    moov.write("hev1", entry, "latin1");

    assert.throws(() => readAvcConfig(moov), UnsupportedCodecError);
  });
});

describe("isKeyframe", () => {
  it("finds an IDR slice among other NAL units", () => {
    const mdat = box("mdat", Buffer.concat([nal(0x06), nal(0x65)]));

    assert.equal(isKeyframe(mdat, 4), true);
  });

  it("returns false for frames without an IDR slice", () => {
    const mdat = box("mdat", Buffer.concat([nal(0x06), nal(0x41)]));

    assert.equal(isKeyframe(mdat, 4), false);
  });

  it("supports shorter NAL length fields", () => {
    const mdat = box("mdat", Buffer.concat([nal(0x41, 2), nal(0x65, 2)]));

    assert.equal(isKeyframe(mdat, 2), true);
  });
});
