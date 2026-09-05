import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

export function useOffline() {
  const [hasController, setHasController] = useState(
    Boolean(navigator.serviceWorker?.controller),
  );
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(
    null,
  );
  const [online, setOnline] = useState(navigator.onLine);
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    const changed = () =>
      setHasController(Boolean(navigator.serviceWorker?.controller));
    const connectivity = () => setOnline(navigator.onLine);
    const install = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    navigator.serviceWorker?.addEventListener("controllerchange", changed);
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    window.addEventListener("beforeinstallprompt", install);
    return () => {
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      window.removeEventListener("beforeinstallprompt", install);
    };
  }, []);
  const install = installPrompt
    ? async () => {
        await installPrompt.prompt();
        await installPrompt.userChoice;
        setInstallPrompt(null);
      }
    : undefined;
  return {
    offlineReady: offlineReady || hasController,
    online,
    needRefresh,
    updateServiceWorker,
    install,
  };
}
