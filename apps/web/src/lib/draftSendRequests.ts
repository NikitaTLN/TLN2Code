import { create } from "zustand";

import { composerTargetKey, type ComposerThreadTarget } from "../composerDraftStore";

// A request the composer never got to (provider missing, environment offline) must not
// fire minutes later when the user next opens that thread.
const REQUEST_TTL_MS = 15_000;

const useDraftSendRequestStore = create<{ readonly requestedAtByKey: Record<string, number> }>(
  () => ({ requestedAtByKey: {} }),
);

/** Asks the composer for `target` to send its draft once it is mounted and able to. */
export function requestDraftSend(target: ComposerThreadTarget): void {
  const key = composerTargetKey(target);
  useDraftSendRequestStore.setState((state) => ({
    requestedAtByKey: { ...state.requestedAtByKey, [key]: Date.now() },
  }));
}

export function useDraftSendRequested(key: string): boolean {
  return useDraftSendRequestStore((state) => state.requestedAtByKey[key] !== undefined);
}

/** Removes the request for `key`; true when it was still fresh enough to act on. */
export function takeDraftSendRequest(key: string): boolean {
  const requestedAt = useDraftSendRequestStore.getState().requestedAtByKey[key];
  if (requestedAt === undefined) return false;
  useDraftSendRequestStore.setState((state) => {
    const { [key]: _taken, ...rest } = state.requestedAtByKey;
    return { requestedAtByKey: rest };
  });
  return Date.now() - requestedAt <= REQUEST_TTL_MS;
}
