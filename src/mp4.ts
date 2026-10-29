// Just enough ISO BMFF (MP4) parsing to relay ffmpeg's fragmented MP4 output:
// split the byte stream into boxes, find the codec, and spot keyframes.

export type Fmp4Event =
  | { type: "init"; mime: string; data: Buffer }
  | { type: "segment"; keyframe: boolean; data: Buffer };

export class UnsupportedCodecError extends Error {
  constructor(sampleEntry: string) {
    super(
      `Unsupported video codec "${sampleEntry}", only H.264 cameras are supported.`
    );
  }
}

type BoxRange = { type: string; start: number; payload: number; end: number };

const readBoxHeader = (buf: Buffer, start: number): BoxRange | undefined => {
  if (buf.length - start < 8) {
    return;
  }
  let size = buf.readUInt32BE(start);
  let payload = start + 8;
  if (size === 1) {
    if (buf.length - start < 16) {
      return;
    }
    size = Number(buf.readBigUInt64BE(start + 8));
    payload = start + 16;
  } else if (size === 0) {
    throw new Error(
      "MP4 boxes that extend to the end of the stream are not supported"
    );
  }
  if (size < payload - start) {
    throw new Error(`Invalid MP4 box size ${size}`);
  }
  return {
    type: buf.toString("latin1", start + 4, start + 8),
    start,
    payload,
    end: start + size,
  };
};

function* childBoxes(buf: Buffer, start: number, end: number) {
  let offset = start;
  while (offset < end) {
    const box = readBoxHeader(buf, offset);
    if (!box || box.end > end) {
      return;
    }
    yield box;
    offset = box.end;
  }
}

const findChild = (buf: Buffer, parent: BoxRange, type: string) => {
  for (const box of childBoxes(buf, parent.payload, parent.end)) {
    if (box.type === type) {
      return box;
    }
  }
};

const hex = (byte: number) => byte.toString(16).padStart(2, "0");

const STSD_HEADER_SIZE = 8; // version, flags and entry count
const VISUAL_SAMPLE_ENTRY_SIZE = 78; // fields before a video sample entry's child boxes

/** Reads the MSE codec string and the NAL unit length size from a `moov` box. */
export const readAvcConfig = (moov: Buffer) => {
  const root = readBoxHeader(moov, 0)!;
  for (const trak of childBoxes(moov, root.payload, root.end)) {
    if (trak.type !== "trak") {
      continue;
    }
    let box: BoxRange | undefined = trak;
    for (const type of ["mdia", "minf", "stbl", "stsd"]) {
      box = box && findChild(moov, box, type);
    }
    if (!box) {
      continue;
    }
    const entry = readBoxHeader(moov, box.payload + STSD_HEADER_SIZE);
    if (!entry || !["avc1", "avc3"].includes(entry.type)) {
      throw new UnsupportedCodecError(entry?.type ?? "unknown");
    }
    const avcC = findChild(
      moov,
      { ...entry, payload: entry.payload + VISUAL_SAMPLE_ENTRY_SIZE },
      "avcC"
    );
    if (!avcC) {
      throw new Error("H.264 track has no avcC box");
    }
    const [, profile, compatibility, level, lengthSizeMinusOne] = moov.subarray(
      avcC.payload,
      avcC.payload + 5
    );
    return {
      codec: `${entry.type}.${hex(profile)}${hex(compatibility)}${hex(level)}`,
      nalLengthSize: (lengthSizeMinusOne & 0b11) + 1,
    };
  }
  throw new Error("MP4 stream has no video track");
};

const NAL_TYPE_IDR = 5;

/** Whether an `mdat` box holds an H.264 IDR frame, which decoding can start from. */
export const isKeyframe = (mdat: Buffer, nalLengthSize: number) => {
  const box = readBoxHeader(mdat, 0)!;
  let offset = box.payload;
  while (offset + nalLengthSize < box.end) {
    const length = mdat.readUIntBE(offset, nalLengthSize);
    if ((mdat[offset + nalLengthSize] & 0x1f) === NAL_TYPE_IDR) {
      return true;
    }
    offset += nalLengthSize + length;
  }
  return false;
};

/**
 * Turns a fragmented MP4 byte stream into an init segment (`ftyp` + `moov`)
 * followed by media segments (`moof` + `mdat`).
 */
export class Fmp4Parser {
  #pending: Buffer = Buffer.alloc(0);
  #ftyp: Buffer | undefined;
  #moof: Buffer | undefined;
  #nalLengthSize: number | undefined;

  push(chunk: Buffer): Fmp4Event[] {
    this.#pending = this.#pending.length
      ? Buffer.concat([this.#pending, chunk])
      : chunk;
    const events: Fmp4Event[] = [];
    let offset = 0;
    for (
      let box = readBoxHeader(this.#pending, offset);
      box && box.end <= this.#pending.length;
      box = readBoxHeader(this.#pending, offset)
    ) {
      const event = this.#handleBox(
        box.type,
        this.#pending.subarray(box.start, box.end)
      );
      if (event) {
        events.push(event);
      }
      offset = box.end;
    }
    // Copy the leftover so the parsed boxes don't keep the whole chunk alive
    this.#pending = Buffer.from(this.#pending.subarray(offset));
    return events;
  }

  #handleBox(type: string, data: Buffer): Fmp4Event | undefined {
    switch (type) {
      case "ftyp":
        this.#ftyp = data;
        return;
      case "moov": {
        const { codec, nalLengthSize } = readAvcConfig(data);
        this.#nalLengthSize = nalLengthSize;
        return {
          type: "init",
          mime: `video/mp4; codecs="${codec}"`,
          data: Buffer.concat([this.#ftyp ?? Buffer.alloc(0), data]),
        };
      }
      case "moof":
        this.#moof = data;
        return;
      case "mdat": {
        if (!this.#moof || this.#nalLengthSize === undefined) {
          return;
        }
        const segment: Fmp4Event = {
          type: "segment",
          keyframe: isKeyframe(data, this.#nalLengthSize),
          data: Buffer.concat([this.#moof, data]),
        };
        this.#moof = undefined;
        return segment;
      }
    }
  }
}
