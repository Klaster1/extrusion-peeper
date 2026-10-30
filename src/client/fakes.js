// Stand-ins for browser APIs, so the client modules can be tested in Node.

export class FakeWebSocket extends EventTarget {
  /** @type {FakeWebSocket[]} */
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.binaryType = "blob";
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.dispatchEvent(new Event("open"));
  }

  receive(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  close() {
    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }
}

/** @param {[number, number][]} ranges */
export const timeRanges = (...ranges) => ({
  length: ranges.length,
  start: (index) => ranges[index][0],
  end: (index) => ranges[index][1],
});

export class FakeSourceBuffer extends EventTarget {
  updating = false;
  buffered = timeRanges();
  /** @type {any[]} */
  appended = [];
  /** @type {[number, number][]} */
  removed = [];

  appendBuffer(data) {
    this.#update();
    this.appended.push(data);
  }

  remove(start, end) {
    this.#update();
    this.removed.push([start, end]);
  }

  /** Finishes the pending operation, like the browser does asynchronously. */
  finish() {
    this.updating = false;
    this.dispatchEvent(new Event("updateend"));
  }

  #update() {
    if (this.updating) {
      throw new Error("InvalidStateError: the SourceBuffer is updating");
    }
    this.updating = true;
  }
}

export class FakeMediaSource extends EventTarget {
  /** @type {FakeMediaSource[]} */
  static instances = [];
  /** @type {FakeSourceBuffer[]} */
  sourceBuffers = [];

  constructor() {
    super();
    FakeMediaSource.instances.push(this);
  }

  addSourceBuffer(mime) {
    const sourceBuffer = new FakeSourceBuffer();
    sourceBuffer.mime = mime;
    this.sourceBuffers.push(sourceBuffer);
    return sourceBuffer;
  }

  open() {
    this.dispatchEvent(new Event("sourceopen"));
  }
}

export const fakeVideo = () => ({
  src: "",
  currentTime: 0,
  paused: true,
  buffered: timeRanges(),
  play() {
    this.paused = false;
    return Promise.resolve();
  },
});

/**
 * Loads the real page markup into a happy-dom window, without running its
 * scripts, and makes its DOM classes globals like in a browser.
 */
export const loadPage = async () => {
  const { Window } = await import("happy-dom");
  const { readFile } = await import("fs/promises");
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  window.document.write(
    await readFile(new URL("../index.html", import.meta.url), "utf-8")
  );
  for (const name of [
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLTemplateElement",
    "SVGSVGElement",
    "FormData",
  ]) {
    globalThis[name] = window[name];
  }
  globalThis.window = window;
  // happy-dom has no Option constructor
  globalThis.Option = function (text = "", value = text) {
    const option = window.document.createElement("option");
    option.textContent = text;
    option.value = value;
    return option;
  };
  return window;
};

/**
 * Dispatches a bubbling event with the given properties, such as `clientY`.
 *
 * @param {EventTarget} target
 * @param {string} type
 * @param {object} [properties]
 */
export const fire = (target, type, properties = {}) => {
  const event = new globalThis.window.Event(type, {
    bubbles: true,
    cancelable: true,
  });
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(event, key, { value });
  }
  target.dispatchEvent(event);
  return event;
};
