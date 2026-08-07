/**
 * Minimal ambient types for `socket.io-client`.
 *
 * The realtime client is an OPTIONAL dependency of this console:
 * `lib/useErrorStream.ts` imports it dynamically and falls back to 10-second
 * polling if the import fails, so every Error Center view works without it.
 *
 * That optionality has to hold at build time too, not just at runtime. Relying
 * on the package's own bundled types would make `tsc` fail outright whenever
 * node_modules is absent or partially installed — turning a dependency the app
 * is explicitly designed to survive without into one that blocks the build.
 *
 * Only the surface `useErrorStream` actually touches is declared. It is
 * deliberately narrow and structurally compatible with the real types, so this
 * stays correct whether or not the package is installed.
 */

declare module "socket.io-client" {
  export interface Socket {
    connected: boolean;
    on(event: string, listener: (...args: never[]) => void): Socket;
    emit(event: string, ...args: unknown[]): Socket;
    disconnect(): Socket;
  }

  export function io(uri: string, opts?: Record<string, unknown>): Socket;
}
