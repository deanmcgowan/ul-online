import { useState, useEffect, useCallback, useRef } from "react";

export interface ScheduledNotification {
  id: string;
  subscriptionId: string;
  notifyAt: Date;
  title: string;
  body: string;
}

export type PushSupportState = "checking" | "unsupported" | "install-required" | "blocked" | "ready";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isInStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).standalone === true
  );
}

function isIOS(): boolean {
  return /ipad|iphone|ipod/i.test(navigator.userAgent);
}

async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/vapid-public-key");
    if (!res.ok) return null;
    const { publicKey } = await res.json() as { publicKey: string };
    return publicKey || null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const SUBSCRIPTION_ID_KEY = "push-subscription-id";

export function usePushNotifications() {
  const [state, setState] = useState<PushSupportState>("checking");
  const [activeNotification, setActiveNotification] = useState<ScheduledNotification | null>(null);
  const subscriptionRef = useRef<PushSubscription | null>(null);
  const subscriptionIdRef = useRef<string>(
    localStorage.getItem(SUBSCRIPTION_ID_KEY) ?? generateId()
  );

  // Evaluate push support on mount
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    // On iOS, push only works from installed PWA
    if (isIOS() && !isInStandaloneMode()) {
      setState("install-required");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    setState("ready");
  }, []);

  const getOrCreateSubscription = useCallback(async (): Promise<PushSubscription | null> => {
    if (subscriptionRef.current) return subscriptionRef.current;

    const vapidPublicKey = await getVapidPublicKey();
    if (!vapidPublicKey) return null;

    const registration = await navigator.serviceWorker.ready;
    let sub = await registration.pushManager.getSubscription();

    if (!sub) {
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      });
    }

    subscriptionRef.current = sub;

    // Persist subscription on the server
    const id = subscriptionIdRef.current;
    localStorage.setItem(SUBSCRIPTION_ID_KEY, id);
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        endpoint: sub.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!))),
        auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!))),
      }),
    });

    return sub;
  }, []);

  const scheduleNotification = useCallback(async (
    departureTime: string,
    walkSeconds: number,
    title: string,
    body: string,
  ): Promise<"ok" | "blocked" | "unsupported" | "install-required" | "error"> => {
    if (state === "unsupported") return "unsupported";
    if (state === "install-required") return "install-required";
    if (state === "blocked") return "blocked";

    try {
      // Request permission if needed
      if (Notification.permission === "default") {
        const result = await Notification.requestPermission();
        if (result === "denied") {
          setState("blocked");
          return "blocked";
        }
      }

      const sub = await getOrCreateSubscription();
      if (!sub) return "error";

      // Calculate notify_at: departureTime (HH:MM) - walkSeconds - 2 min prep
      const [hh, mm] = departureTime.split(":").map(Number);
      const notifyAt = new Date();
      notifyAt.setHours(hh, mm, 0, 0);
      notifyAt.setSeconds(notifyAt.getSeconds() - walkSeconds - 120);
      // If computed time is in the past, try adding 1 day (next day's trip)
      if (notifyAt <= new Date()) {
        notifyAt.setDate(notifyAt.getDate() + 1);
      }

      const notification: ScheduledNotification = {
        id: generateId(),
        subscriptionId: subscriptionIdRef.current,
        notifyAt,
        title,
        body,
      };

      const res = await fetch("/api/push/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: notification.id,
          subscriptionId: notification.subscriptionId,
          notifyAt: notifyAt.toISOString(),
          title,
          body,
        }),
      });

      if (!res.ok) return "error";

      setActiveNotification(notification);
      return "ok";
    } catch (e) {
      console.error("Failed to schedule notification:", e);
      return "error";
    }
  }, [state, getOrCreateSubscription]);

  const cancelNotification = useCallback(async () => {
    if (!activeNotification) return;
    try {
      await fetch(`/api/push/schedule/${activeNotification.id}`, { method: "DELETE" });
    } catch {
      // Best effort
    }
    setActiveNotification(null);
  }, [activeNotification]);

  return {
    state,
    activeNotification,
    scheduleNotification,
    cancelNotification,
  };
}
