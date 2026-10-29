/**
 * Opens a WebSocket that reconnects whenever it closes, so the page recovers
 * after the server restarts.
 *
 * @param {string} url
 * @param {{
 *   onMessage: (data: any) => void;
 *   onOpen?: (socket: WebSocket) => void;
 *   binaryType?: BinaryType;
 *   reconnectDelayMs?: number;
 *   WebSocketImpl?: typeof WebSocket;
 * }} options
 * @returns {{ close(): void }}
 */
export function connectSocket(
  url,
  {
    onMessage,
    onOpen = () => {},
    binaryType,
    reconnectDelayMs = 2000,
    WebSocketImpl = WebSocket,
  }
) {
  /** @type {WebSocket} */
  let socket;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let reconnectTimer;
  let closed = false;

  const open = () => {
    socket = new WebSocketImpl(url);
    if (binaryType) {
      socket.binaryType = binaryType;
    }
    socket.addEventListener("open", () => onOpen(socket));
    socket.addEventListener("message", (event) => onMessage(event.data));
    socket.addEventListener("close", () => {
      if (!closed) {
        reconnectTimer = setTimeout(open, reconnectDelayMs);
      }
    });
  };
  open();

  return {
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      socket.close();
    },
  };
}

/** @typedef {import("../protocol.ts").SocketMessages} SocketMessages */

/**
 * Connects to one of the server's JSON routes, with messages typed by route.
 *
 * @template {keyof SocketMessages} Path
 * @param {Path} path
 * @param {(message: SocketMessages[Path]) => void} onMessage
 * @param {{ location?: { protocol: string; host: string }; WebSocketImpl?: typeof WebSocket }} [options]
 */
export function connectJsonSocket(
  path,
  onMessage,
  { location = globalThis.location, WebSocketImpl = WebSocket } = {}
) {
  return connectSocket(socketUrl(path, location), {
    onMessage: (data) => onMessage(JSON.parse(data)),
    WebSocketImpl,
  });
}

/**
 * @param {string} path
 * @param {{ protocol: string; host: string }} location
 */
export const socketUrl = (path, location = globalThis.location) =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
