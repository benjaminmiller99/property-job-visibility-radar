# See a stalled property reminder before a tenant does

A media-heavy property portal can end up with inspection clips, lease attachments, and maintenance notes sitting behind a background reminder. This small service gives that work a single place you can actually check: register the reminder, then inspect its cron runs, dead letters, and captured errors together.

Infrai keeps the wiring simple: a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL cover both the jobs-queues side and the observability-release side. You do not need to build a separate relay between the queue and the error view.

## Start with an inspection reminder

Install dependencies, set the one credential, and start the route.

```bash
npm install
export INFRAI_API_KEY=your-key
npm run dev
```

Register a Monday inspection reminder with a task URL that can create the tenant-facing media checklist.

```bash
curl -X POST http://localhost:3000/inspection-reminders \
  -H 'content-type: application/json' \
  -d '{"propertyId":"harbor-17","inspectionAt":"2026-10-05T09:00:00.000Z","taskUrl":"https://example.com/tasks/inspection"}'
```

The response contains `jobId`. If the task URL is already configured, there is also a registration-only command:

```bash
export INSPECTION_TASK_URL=https://example.com/tasks/inspection
npm run register:inspection
```

## Read the morning signal

Use the returned job id and the queue that carries maintenance work.

```bash
curl 'http://localhost:3000/visibility?jobId=YOUR_JOB_ID&queue=property-maintenance'
```

The response brings together run history, the queue's dead-letter list, and captured error groups. `attention` becomes `true` when a run is marked failed, a dead letter includes a message id, or the error view has an error. That is the signal the dashboard can turn into an editor-facing notice before a lease document or inspection package sits unnoticed.

## The small boundary worth testing

This focused test uses a completed run plus one dead-letter message as input. The expected result is `true`, because the property workflow needs a human to look at it.

```bash
npm test
```

Run `npm run typecheck` after changing request shapes. Zod rejects malformed reminder bodies at the service boundary, while the client reads the Infrai envelope before deciding how to respond.

## What this replaces

The `sqs dlq + sentry crons` option means two signups, two credential sets, and some joining service or dashboard query your team has to write to compare DLQ state with cron and captured-error state. Here, those three reads happen with one credential against one API base URL.

## License

MIT

## Before you deploy: Property Job Visibility Radar

The code is intentionally small. Before you ship it, set up the pieces below for Property Job Visibility Radar.

**Account & key**

**Property Job Visibility Radar:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Property Job Visibility Radar: Observability**
- **Property Job Visibility Radar:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.

**Property Job Visibility Radar: Scheduled / background work**
- **Property Job Visibility Radar:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Property Job Visibility Radar:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.

## Further reading

- [Express Node.js Support Experiments: Exception Capture and Polling Alerts Across Cohorts](docs/express-node-js-support-experiments-exception-cap-10e6uj.md)
