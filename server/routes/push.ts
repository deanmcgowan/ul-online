import { Hono } from "hono";
import webpush from "web-push";
import { getDb } from "../db.js";

const app = new Hono();

// VAPID setup — keys are optional so the server stays healthy when not configured.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const isPushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (isPushConfigured) {
  webpush.setVapidDetails("mailto:noreply@ul-online.app", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

/** Return the public VAPID key so the client can subscribe. */
app.get("/vapid-public-key", (c) => {
  if (!isPushConfigured) {
    return c.json({ error: "Push not configured" }, 503);
  }
  return c.json({ publicKey: VAPID_PUBLIC_KEY });
});

/** Save or update a push subscription. */
app.post("/subscribe", async (c) => {
  if (!isPushConfigured) {
    return c.json({ error: "Push not configured" }, 503);
  }

  const body = await c.req.json<{ id: string; endpoint: string; p256dh: string; auth: string }>();
  if (!body?.id || !body?.endpoint || !body?.p256dh || !body?.auth) {
    return c.json({ error: "Invalid subscription" }, 400);
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO push_subscriptions (id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, id = excluded.id
  `).run(body.id, body.endpoint, body.p256dh, body.auth);

  return c.json({ ok: true });
});

/** Schedule a "time to leave" notification. */
app.post("/schedule", async (c) => {
  if (!isPushConfigured) {
    return c.json({ error: "Push not configured" }, 503);
  }

  const body = await c.req.json<{
    id: string;
    subscriptionId: string;
    notifyAt: string; // ISO 8601
    title: string;
    body: string;
  }>();
  if (!body?.id || !body?.subscriptionId || !body?.notifyAt || !body?.title || !body?.body) {
    return c.json({ error: "Invalid notification" }, 400);
  }

  // Validate that notifyAt is a plausible future time (within 24 hours)
  const notifyTime = new Date(body.notifyAt).getTime();
  const now = Date.now();
  if (Number.isNaN(notifyTime) || notifyTime < now || notifyTime > now + 24 * 60 * 60 * 1000) {
    return c.json({ error: "notifyAt must be within the next 24 hours" }, 400);
  }

  const db = getDb();
  // Cancel any existing unsent notification from this subscription (one active notification per subscription)
  db.prepare(`
    DELETE FROM scheduled_notifications
    WHERE subscription_id = ? AND sent_at IS NULL
  `).run(body.subscriptionId);

  db.prepare(`
    INSERT INTO scheduled_notifications (id, subscription_id, notify_at, title, body)
    VALUES (?, ?, ?, ?, ?)
  `).run(body.id, body.subscriptionId, body.notifyAt, body.title, body.body);

  return c.json({ ok: true });
});

/** Cancel a scheduled notification. */
app.delete("/schedule/:id", (c) => {
  const { id } = c.req.param();
  const db = getDb();
  db.prepare(`DELETE FROM scheduled_notifications WHERE id = ? AND sent_at IS NULL`).run(id);
  return c.json({ ok: true });
});

export { app as pushRoute };
export { isPushConfigured, VAPID_PUBLIC_KEY };

/** Scheduler — call once at server startup. */
export function startPushScheduler(): void {
  if (!isPushConfigured) return;

  const tick = () => {
    const db = getDb();
    const now = new Date().toISOString();
    // Only pick up notifications due in the last 5 min (prevent re-sending very old ones on restart)
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const due = (db.prepare(`
      SELECT sn.id, sn.title, sn.body, ps.endpoint, ps.p256dh, ps.auth
      FROM scheduled_notifications sn
      JOIN push_subscriptions ps ON sn.subscription_id = ps.id
      WHERE sn.notify_at <= ? AND sn.notify_at >= ? AND sn.sent_at IS NULL
    `).all(now, staleThreshold)) as Array<{
      id: string; title: string; body: string;
      endpoint: string; p256dh: string; auth: string;
    }>;

    for (const notification of due) {
      webpush.sendNotification(
        { endpoint: notification.endpoint, keys: { p256dh: notification.p256dh, auth: notification.auth } },
        JSON.stringify({ title: notification.title, body: notification.body }),
      ).then(() => {
        db.prepare(`UPDATE scheduled_notifications SET sent_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), notification.id);
      }).catch((err: { statusCode?: number }) => {
        console.error("Push send error:", err);
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription gone — clean up
          db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(notification.endpoint);
        }
        db.prepare(`UPDATE scheduled_notifications SET sent_at = 'FAILED' WHERE id = ?`).run(notification.id);
      });
    }
  };

  // Run every 30 seconds
  setInterval(tick, 30_000);
  // Also run once immediately in case of a server restart with pending notifications
  setTimeout(tick, 5_000);
}
