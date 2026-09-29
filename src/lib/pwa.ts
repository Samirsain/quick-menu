// Installable-app plumbing. Imported once from main.tsx so the browser's `beforeinstallprompt`
// event is caught even if it fires before any install button has mounted.

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Running as the installed app (home-screen icon), not in a browser tab */
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** iPhone/iPad: no install prompt API, installing is Share -> Add to Home Screen */
export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** The browser offered a one-tap install (Chrome, Edge, Samsung Internet...) */
export const canPromptInstall = () => deferredPrompt !== null;

/** Shows the browser's install dialog. Resolves true if the user installed. */
export async function promptInstall(): Promise<boolean> {
  const event = deferredPrompt;
  if (!event) return false;
  deferredPrompt = null; // a prompt event can only be used once
  await event.prompt();
  const { outcome } = await event.userChoice;
  notify();
  return outcome === "accepted";
}

export function onInstallStateChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // we show our own button instead of the browser's mini bar
  deferredPrompt = e as InstallPromptEvent;
  notify();
});
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  notify();
});

// Same worker OneSignal uses (see public/OneSignalSDKWorker.js). Skipped in dev so Vite's hot reload isn't cached.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/OneSignalSDKWorker.js").catch((err) => console.warn("Service worker not registered:", err));
  });
}
