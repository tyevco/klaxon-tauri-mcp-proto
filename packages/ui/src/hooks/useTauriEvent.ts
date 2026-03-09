import { useEffect, useRef, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

/**
 * Subscribe to one or more Tauri events with automatic cleanup.
 * Handles the Promise<UnlistenFn> pattern correctly and logs errors.
 */
export function useTauriEvents(
  events: Array<{ event: string; handler: (payload: any) => void }>,
  deps: React.DependencyList = [],
) {
  useEffect(() => {
    const unsubs: Promise<UnlistenFn>[] = events.map(({ event, handler }) =>
      listen(event, (e) => handler(e.payload)).catch((err) => {
        console.error(`[useTauriEvent] Failed to listen to "${event}":`, err);
        return () => {}; // noop unlisten on failure
      }),
    );
    return () => {
      unsubs.forEach((p) => p.then((u) => u()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Subscribe to a single Tauri event with automatic cleanup.
 */
export function useTauriEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void,
  deps: React.DependencyList = [],
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = listen<T>(event, (e) => handlerRef.current(e.payload)).catch(
      (err) => {
        console.error(`[useTauriEvent] Failed to listen to "${event}":`, err);
        return () => {};
      },
    );
    return () => {
      unsub.then((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Wraps invoke() with error handling. Returns a stable callback.
 * Logs errors to console and optionally calls an onError callback.
 */
export function useTauriInvoke<T = unknown>(
  command: string,
  onError?: (err: unknown) => void,
): (...args: Parameters<typeof invoke>) => Promise<T | undefined> {
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  return useCallback(
    async (...args: Parameters<typeof invoke>) => {
      try {
        return await invoke<T>(args[0] ?? command, args[1]);
      } catch (err) {
        console.error(`[useTauriInvoke] ${command} failed:`, err);
        onErrorRef.current?.(err);
        return undefined;
      }
    },
    [command],
  );
}
