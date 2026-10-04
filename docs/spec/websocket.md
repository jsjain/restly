# WebSocket

WebSocket requests. Part of the [Restly spec](README.md).

## D16 WebSocket

A WebSocket request is a collection item with the member `"x-restly-type": "websocket"`, because Postman leaves WebSocket requests out of its exports and has no format to follow. URL, params, headers, and auth resolve as for HTTP. The tab sends text messages and logs sent, received, open, close, and error events. The runner skips these items and no scripts run. The client is `gorilla/websocket`, already in the module graph through Wails.
