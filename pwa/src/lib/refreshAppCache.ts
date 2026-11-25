/**
 * Drops the service worker's Cache Storage entries (precached JS/CSS/HTML)
 * and re-registers a fresh service worker, then reloads. This only touches
 * Cache Storage; notes and food entries live on the server (plan 8).
 */
export async function refreshAppCache(): Promise<void> {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  window.location.reload();
}
