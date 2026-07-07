// ============================================================================
// Jitsi IFrame API loader
// ============================================================================
// Loads Jitsi's official external_api.js on demand and exposes the global
// JitsiMeetExternalAPI constructor. Works for both public meet.jit.si and JaaS
// (8x8.vc), which serves a per-tenant script at /{appId}/external_api.js.
//
// We use the IFrame API directly rather than @jitsi/react-sdk: the SDK only
// wraps this same script, and its peer-deps cap at React 18 (our client is
// React 19). This keeps the dependency tree clean.
// ============================================================================

export interface JitsiApi {
  dispose(): void;
  addEventListener(event: string, listener: (...args: unknown[]) => void): void;
  removeEventListener(event: string, listener: (...args: unknown[]) => void): void;
  executeCommand(command: string, ...args: unknown[]): void;
}

type JitsiApiCtor = new (domain: string, options: Record<string, unknown>) => JitsiApi;

declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiApiCtor;
  }
}

const loading = new Map<string, Promise<JitsiApiCtor>>();

/**
 * Ensure the external_api.js for the given domain is loaded and return the
 * JitsiMeetExternalAPI constructor. Cached per script URL so repeat mounts
 * don't re-inject the tag.
 */
export function loadJitsiApi(domain: string, appId?: string): Promise<JitsiApiCtor> {
  const isJaas = domain.includes("8x8.vc");
  const src = isJaas && appId
    ? `https://8x8.vc/${appId}/external_api.js`
    : `https://${domain}/external_api.js`;

  if (window.JitsiMeetExternalAPI) {
    return Promise.resolve(window.JitsiMeetExternalAPI);
  }
  const existing = loading.get(src);
  if (existing) return existing;

  const promise = new Promise<JitsiApiCtor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      if (window.JitsiMeetExternalAPI) resolve(window.JitsiMeetExternalAPI);
      else reject(new Error("Jitsi API loaded but JitsiMeetExternalAPI is undefined"));
    };
    script.onerror = () => {
      loading.delete(src); // allow a later retry
      reject(new Error(`Failed to load Jitsi from ${src}`));
    };
    document.body.appendChild(script);
  });

  loading.set(src, promise);
  return promise;
}
