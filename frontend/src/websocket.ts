import type { Item } from "./types";

// Postman cannot export WebSocket requests, so Restly marks its own with this item member.
// Matches TypeKey in internal/collection.
export const WS_TYPE_KEY = "x-restly-type";

export function isWebSocket(item: Item | undefined): boolean {
  return item?.[WS_TYPE_KEY] === "websocket";
}

export function newWebSocketItem(): Item {
  return {
    name: "New WebSocket",
    [WS_TYPE_KEY]: "websocket",
    request: { method: "GET", header: [], url: { raw: "" } },
  };
}
