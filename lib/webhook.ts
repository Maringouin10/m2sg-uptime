import { createHmac } from "node:crypto";
import type { State } from "./monitors";

export type WebhookEventName = "monitor.down" | "monitor.degraded" | "monitor.up";

export type WebhookEvent = {
  event: WebhookEventName;
  timestamp: string;
  monitor: { id: string; name: string; url: string };
  state: State;
  previous_state: State | null;
  /** Panne liée (ouverte par monitor.down, fermée au retour), sinon null. */
  incident: {
    id: number;
    started_at: string;
    ended_at: string | null;
    duration_s: number | null;
    error: string | null;
  } | null;
  check: { status_code: number | null; response_ms: number | null; error: string | null };
  /** Sous-services (endpoints de statut détaillé uniquement). */
  components?: { id: string; name: string; state: State }[];
};

export function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export async function sendWebhook(payload: WebhookEvent): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "m2sg-uptime/1.0",
    "x-m2sg-event": payload.event,
  };
  const secret = process.env.ALERT_WEBHOOK_SECRET;
  if (secret) headers["x-m2sg-signature"] = sign(body, secret);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return;
      console.error(`[webhook] ${payload.event} -> HTTP ${res.status} (essai ${attempt})`);
    } catch (err) {
      console.error(`[webhook] ${payload.event} -> ${String(err)} (essai ${attempt})`);
    }
  }
}
