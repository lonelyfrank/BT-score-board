// The Workers runtime types are imported as a module (see cf.ts): the shared web and engine
// code is typed against the browser, whose storage helpers simply find nothing on Workers.
declare module 'cloudflare:workers' {
  import type { DurableObjectState } from '@cloudflare/workers-types/index.ts';
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
    fetch?(request: Request): Response | Promise<Response>;
  }
}
declare module 'cloudflare:workers' {
  interface DurableObject {
    webSocketMessage?(ws: WebSocket, message: string | ArrayBuffer): void | Promise<void>;
    webSocketClose?(
      ws: WebSocket,
      code: number,
      reason: string,
      wasClean: boolean,
    ): void | Promise<void>;
    webSocketError?(ws: WebSocket, error: unknown): void | Promise<void>;
  }
}
/** The Workers-only WebSocket pair: the page opens one end, the Durable Object keeps the other. */
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}
declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string);
  readonly request: string;
  readonly response: string;
}
