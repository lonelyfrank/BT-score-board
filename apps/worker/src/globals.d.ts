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
