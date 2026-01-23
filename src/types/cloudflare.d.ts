declare global {
  interface ResponseInit {
    webSocket?: WebSocket;
  }
}

export {};
