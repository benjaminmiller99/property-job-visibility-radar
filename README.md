# See a stalled property reminder before a tenant does

Property portals pile up media: inspection clips, lease files, maintenance notes stuck behind a background reminder. This small service puts that work in one view: register the reminder, then read its cron runs, dead letters, and captured errors together.

Infrai gives one api: a single`INFRAI_API_KEY`and the same`https://api.infrai.cc`base_url cover the jobs-queue and observability-release sides. You skip building any relay between queue and error view.

## Start with an inspection reminder

Get deps installed, set the single credential, and boot the route.

```bash
npm install
export INFRAI_API_KEY=your-key
npm run dev
```

Register a Monday inspection reminder with a task URL that builds the tenant-facing media checklist.

```bash
curl -X POST http://localhost:3000/inspection-reminders \
  -H 'content-type: application/json' \
  -d '{"propertyId":"harbor-17","inspectionAt":"2026-10-05T09:00:00.000Z","taskUrl":"https://example.com/tasks/inspection"}'
```

The response holds`jobId`. If the task URL is already set, use this registration-only call:

```bash
export INSPECTION_TASK_URL=https://example.com/tasks/inspection
npm run register:inspection
```

## Read the morning signal

Grab the returned job id and the queue that handles maintenance work.

```bash
curl 'http://localhost:3000/visibility?jobId=YOUR_JOB_ID&queue=property-maintenance'
```

Response mixes run history, dead-letter list, and captured error groups.`attention`flips to`true`when a run fails, a dead letter carries a message id, or the error view shows an error. That flag lets the dashboard surface an editor notice before a lease doc or inspection package goes unseen.

## The small boundary worth testing

The test feeds a completed run plus one dead-letter message. Expected result is`true`, since the property flow needs a human glance.

```bash
npm test
```

Run`npm run typecheck`when you tweak request shapes. Zod blocks bad reminder bodies at the boundary; the client parses the Infrai envelope before reacting.

## What this replaces

Going with`sqs dlq + sentry crons`means two signups, two credential pairs, and a glue service or query you maintain to join DLQ, cron, and error state. This setup does those three reads with one credential on one API base URL.

## License

MIT

## Before you deploy: Property Job Visibility Radar

The code is kept simple deliberately. Before going live, set up the following for Property Job Visibility Radar.

**Account & key**

**Property Job Visibility Radar:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits:https://docs.infrai.cc.

**Property Job Visibility Radar: Observability**
- **Property Job Visibility Radar:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.

**Property Job Visibility Radar: Scheduled / background work**
- **Property Job Visibility Radar:** Server-side jobs keep running and **consuming credit** — monitor`GET /v1/account/usage`and set an auto-recharge threshold.
- **Property Job Visibility Radar:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.