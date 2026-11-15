# M2SG Uptime

Page de statut + API pour **m2sg.com** et **mail.m2sg.com/healthz**, hébergée sur Vercel.

- Vérification toutes les **60 s** ; pendant une panne, une vérif supplémentaire **30 s** plus tard.
- Panne = erreur réseau, délai > 10 s, ou code HTTP hors 200-399 (redirections suivies).
- Uptime sur **24 h / 30 jours / 1 an / depuis toujours**, pondéré par le temps.
- Barre des 90 derniers jours (fuseau America/Toronto).
- API JSON publique en lecture + webhook signé à chaque panne / rétablissement.

## Mise en ligne

### 1. Projet Vercel
1. Importer ce dépôt GitHub dans Vercel (framework Next.js détecté automatiquement).
2. **Storage → Create Database → Neon** et la lier au projet : `DATABASE_URL` est ajoutée toute seule.
3. **Settings → Environment Variables** :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui (auto via Neon) | Connexion Postgres (chaîne *pooled*) |
| `CRON_SECRET` | oui | Protège `/api/cron/check`. Générer : `openssl rand -hex 32` |
| `ALERT_WEBHOOK_URL` | non | URL qui reçoit les alertes |
| `ALERT_WEBHOOK_SECRET` | non (recommandé) | Clé de la signature HMAC des alertes |

4. Redéployer. Les tables sont créées automatiquement au premier appel
   (ou manuellement : `DATABASE_URL=... npm run db:migrate`).

### 2. cron-job.org (le déclencheur)
Vercel gratuit ne sait pas lancer une tâche chaque minute, donc on utilise [cron-job.org](https://cron-job.org) (gratuit) :

1. Créer un compte, puis **Create cronjob**.
2. URL : `https://<ton-projet>.vercel.app/api/cron/check`
3. Planification : **every 1 minute**.
4. Onglet **Advanced → Headers** : `Authorization` = `Bearer <CRON_SECRET>`
   (ou, plus simple mais moins discret : ajouter `?key=<CRON_SECRET>` à l'URL).
5. Enregistrer. La réponse doit être `{"ok":true,...}`.

L'appel répond tout de suite ; si un service est en panne, la fonction refait
elle-même une vérif 30 s plus tard (après la réponse, via `after()`), d'où le rythme de 30 s en panne.

## API

Lecture publique, CORS ouvert (`Access-Control-Allow-Origin: *`), cache 10 s.

### `GET /api/status`
```json
{
  "status": "up",              // up | degraded | down | unknown
  "generated_at": "2026-11-15T22:53:42.766Z",
  "monitors": [ /* voir ci-dessous */ ]
}
```

### `GET /api/status/{id}` — `id` = `website` ou `mail`
```json
{
  "id": "mail",
  "name": "Mail",
  "url": "https://mail.m2sg.com/healthz",
  "status": "up",              // up | down | unknown
  "last_check": { "checked_at": "...", "ok": true, "status_code": 200, "response_ms": 120, "error": null },
  "uptime": {
    "24h":  { "percent": 100,     "up_s": 86400, "total_s": 86400, "down_s": 0 },
    "30d":  { "percent": 99.9861, "up_s": ...,   "total_s": ...,   "down_s": 360 },
    "365d": { ... },
    "all":  { ... }
  },
  "since": "2026-11-15",
  "current_incident": null     // ou un incident (voir ci-dessous) si en panne
}
```
`percent` vaut `null` tant qu'il n'y a aucune donnée sur la période.

### `GET /api/incidents?monitor=mail&limit=20`
`monitor` optionnel, `limit` 1–100 (défaut 20). Plus récents d'abord.
```json
{
  "incidents": [
    { "id": 1, "monitor_id": "mail", "started_at": "...", "ended_at": "...",
      "duration_s": 58, "ongoing": false, "error": "HTTP 503" }
  ]
}
```

## Webhook d'alerte

`POST` JSON vers `ALERT_WEBHOOK_URL` à chaque changement d'état (2 essais, délai 5 s).

En-têtes : `X-M2SG-Event: monitor.down | monitor.up` et
`X-M2SG-Signature: sha256=<hmac_sha256_hex(ALERT_WEBHOOK_SECRET, corps brut)>`.

```json
{
  "event": "monitor.up",
  "timestamp": "2026-11-15T22:53:34.864Z",
  "monitor": { "id": "mail", "name": "Mail", "url": "https://mail.m2sg.com/healthz" },
  "incident": { "id": 1, "started_at": "...", "ended_at": "...", "duration_s": 58, "error": "HTTP 503" },
  "check": { "status_code": 200, "response_ms": 120, "error": null }
}
```

Vérification côté récepteur (Node) :
```js
import { createHmac, timingSafeEqual } from "node:crypto";

function isValid(rawBody, header, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return header && header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
```

## Fonctionnement / données

- `checks` : chaque vérif, avec `duration_s` = temps écoulé depuis la précédente.
  L'uptime = secondes « up » / secondes totales, donc les vérifs à 30 s pendant
  une panne ne comptent pas double. Un trou > 150 s (surveillance arrêtée) compte pour 60 s.
  Gardées **90 jours** (purge automatique chaque heure).
- `daily_stats` : agrégats par jour (heure de Toronto), gardés **à vie** → uptime 1 an / depuis toujours.
- `incidents` : début / fin de chaque panne.

Pour ajouter un service : `lib/monitors.ts`.

## Développement local
```bash
npm install
cp .env.example .env.local   # remplir DATABASE_URL et CRON_SECRET
npm run dev
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/check
```
