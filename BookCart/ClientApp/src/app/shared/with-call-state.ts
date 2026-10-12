import { computed } from "@angular/core";
import { signalStoreFeature, withComputed, withState } from "@ngrx/signals";

/** Where the last request of a store is: not started, under way, done, or failed with a displayable text. */
export type CallState = "init" | "loading" | "loaded" | { error: string };

/**
 * Adds `callState` to a store, with `loading`, `loaded` and `error` (the text, or null) derived from it. Change it with
 * `patchState(store, setLoading())`, `setLoaded()` or `setError(text)`.
 */
export function withCallState() {
  return signalStoreFeature(
    withState<{ callState: CallState }>({ callState: "init" }),
    withComputed(({ callState }) => ({
      loading: computed(() => callState() === "loading"),
      loaded: computed(() => callState() === "loaded"),
      error: computed(() => {
        const state = callState();
        return typeof state === "object" ? state.error : null;
      }),
    }))
  );
}

export const setInit = () => ({ callState: "init" as CallState });
export const setLoading = () => ({ callState: "loading" as CallState });
export const setLoaded = () => ({ callState: "loaded" as CallState });
export const setError = (error: string) => ({
  callState: { error } as CallState,
});
