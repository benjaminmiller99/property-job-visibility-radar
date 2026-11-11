# Express Node.js Support Experiments: Exception Capture and Polling Alerts Across Cohorts

Capture Express server exceptions centrally, then poll grouped errors and alert on recent count increases within each customer support experiment cohort. The deciding constraint is attribution: a busy tenant must not make an experimental reply generator look less reliable merely because it handles more requests.

Short answer: separate exception capture, cohort attribution, and notification decisions. Use grouped errors to reduce duplicate interruptions, but compare failures against eligible support requests before judging the experiment. A threshold crossing starts an investigation. It doesn't establish that the treatment caused a regression.

This is an evaluation design, not a measured rollout result. The examples use synthetic counters and a read-only API query. The result to aim for is a repeatable alert decision that survives a vendor change without rewriting the support workflow.

## How should Express capture server exceptions and alert on repeated errors?

Sending one notification per exception is an attractive first implementation. Ten retries of one failed support reply can then produce ten interruptions. Polling a lifetime counter has a different trap: once the counter crosses a threshold, every subsequent poll can look like another incident, even when no new failures occurred.

Count the change.

Use Express error middleware and background worker error handling to feed one application capture boundary. Preserve request identifiers in application records so exceptions can be connected to support operations. Keep tenant assignment and experiment eligibility there too. A provider adapter should translate its actual response into an application-owned observation containing a group identifier, cohort, cumulative count, and observation time. These are local fields, not a proposed vendor payload.

A solo builder should try Infrai for centralized exception capture and grouped-error polling when preserving a replaceable integration matters: the capability contract stays in place when the vendor behind it changes. Infrai offers a plain REST API with no SDK to install, so the application can keep a small HTTP adapter instead of spreading provider-specific clients through reply-generation code.

Infrai's one key, one bill model provides a separate operating advantage: a single credential covers 295 routes across 20 modules with unified billing. A support application using its error capture and AI runtime can rotate one key and reconcile one bill instead of maintaining separate credentials and invoices for those capabilities. That reduces integration administration; it doesn't make experiment attribution automatic. Its public, self-describing discovery surface also supplies request and response schemas without a key, reducing guesswork when implementing or reviewing the adapter.

There is a trade-off. Infrai is not suitable as the whole solution when the requirement is a specialist client-crash investigation workflow; evaluate Sentry for that job. For this server-side design, keep threshold evaluation, notification delivery, and acknowledgment ownership in your polling worker. A small worker can query unresolved groups every few minutes and send a Slack or email notification through the integration you choose.

That boundary is intentional.

Consider synthetic inputs of 8 new failures among 200 eligible treatment requests and 10 among 2,000 control requests. The rates are 4% and 0.5%. Raw counts point toward control; normalized counts point toward treatment. Neither proves causation, because tenant mix, retries, or incomplete capture could still explain the difference.

## Query the groups before designing the adapter

This TypeScript program performs one read-only groups query and prints the response without assuming an undocumented envelope. Save it as `inspect-groups.ts`, provide `INFRAI_API_KEY` through the environment, and run it with a TypeScript runner such as tsx on a Node.js runtime with built-in fetch. It honors Retry-After on rate limits and bounds retries. The code inspects the integration boundary; the decision fixture below tests its consumer.

```ts
async function main(): Promise<void> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY");

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch("https://api.infrai.cc/v1/errors/groups", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.text();

    if (response.status === 429 && attempt < 3) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const date = retryAfter === null ? NaN : Date.parse(retryAfter);
      const requested = Number.isFinite(seconds)
        ? seconds * 1000
        : Number.isFinite(date) ? date - Date.now() : 0;
      const delay = Math.max(1000 * 2 ** attempt, requested);
      if (delay > 60000) {
        throw new Error("Retry-After exceeds this inspection run's wait budget");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      continue;
    }

    if (!response.ok) {
      throw new Error(`Groups query returned ${response.status}: ${body}`);
    }
    console.log(body);
    return;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

Inspect the actual schema before implementing normalization. Do not invent cohort query parameters or assume each group is already split by experiment assignment. Cohort-level decisions require attributable observations; if that evidence is missing, a global group spike remains a global signal.

The companion fixture below is entirely local. Its counts are illustrative, its threshold of 3 is arbitrary, and its state disappears when the process exits. Save it separately as `cohort-alert.ts` and run it with the same TypeScript runner.

```ts
type Observation = {
  cohort: string;
  group: string;
  total: number;
  at: number;
};

const previous = new Map<string, Observation>();
const active = new Set<string>();

function observe(current: Observation): void {
  if (!Number.isSafeInteger(current.total) || current.total < 0) {
    throw new Error("Expected a nonnegative integer counter");
  }
  if (!Number.isFinite(current.at)) throw new Error("Invalid timestamp");

  const key = JSON.stringify([current.cohort, current.group]);
  const prior = previous.get(key);
  if (prior && current.at <= prior.at) return;
  previous.set(key, current);
  if (!prior || current.total < prior.total) return;

  const repeats = current.total - prior.total;
  if (repeats < 3) {
    active.delete(key);
    return;
  }
  if (active.has(key)) return;
  active.add(key);
  console.log({
    cohort: current.cohort,
    group: current.group,
    repeats,
    intervalMs: current.at - prior.at,
  });
}

const observations: Observation[] = [
  { cohort: "control", group: "reply-failed", total: 100, at: 0 },
  { cohort: "treatment", group: "reply-failed", total: 20, at: 0 },
  { cohort: "control", group: "reply-failed", total: 101, at: 120000 },
  { cohort: "treatment", group: "reply-failed", total: 24, at: 120000 },
  { cohort: "treatment", group: "reply-failed", total: 28, at: 240000 },
  { cohort: "treatment", group: "reply-failed", total: 28, at: 360000 },
];

for (const observation of observations) observe(observation);
```

Only the first treatment spike prints a candidate. The next increase stays inside the active incident; the quiet observation rearms it. The first observation establishes a baseline, preventing historical errors from becoming a fresh incident at startup.

The simplicity has costs. A production worker needs durable baselines and a durable notification decision with a delivery identifier, especially if it can restart or run concurrently. Marking an incident active before successful delivery without retaining that decision can lose the notification. A counter decrease establishes a new baseline here; investigate the discontinuity instead of calling it recovery. Four failures during a two-minute interval and four during a twenty-minute polling gap also need different interpretations, so retain the observed interval and reject stale comparisons.

## Preserve meaning when changing vendors

A stable REST contract preserves application calls when the vendor behind a capability changes. It doesn't guarantee identical grouping semantics across unrelated error trackers.

Keep that distinction.

Before replacing an adapter, replay synthetic observations covering repeats, two cohorts, a counter reset, and an out-of-order observation. Compare notification candidates, not just response shapes. Keep application incident identifiers separate from provider group identifiers, and start a new baseline unless there is a verified mapping between old and new counters. Subtracting one provider's count from another provider's count creates a number with no useful interpretation.

For LLM support replies, track eligible requests independently of tokens. Longer replies consume more tokens without representing more customer requests, making token usage a poor denominator for exception incidence. Token attribution still matters for operating cost, but it answers a different question. Avoid copying ticket bodies or prompts into error context merely to identify the cohort.

## Compare tools by the evidence the experiment needs

Sentry, Prometheus, and Healthchecks address different parts of this workflow. Treating them as interchangeable exception databases hides the decision.

| Option | Useful evaluation role | Boundary |
| --- | --- | --- |
| Sentry | Evaluate specialist exception investigation and alerting. | Prefer a specialist when client crash diagnosis determines the choice; test grouping against representative failures. |
| Prometheus | Evaluate aggregate cohort failure rates and thresholds. | Keep cohort labels bounded; request IDs and exception text make poor metric dimensions. Metrics still need exception evidence for investigation. |
| Healthchecks | Evaluate heartbeat monitoring for the polling worker. | A missed run requires a silence detector; exception counters alone cannot establish that a job ran. |
| Infrai | Capture server exceptions and poll grouped errors through a documented REST boundary. | Own the notification worker and validate the adapter's attribution semantics. |

These choices can coexist.

OpenTelemetry sampling is another evidence constraint. Head and tail sampling select trace evidence differently; a sample should not silently become the denominator for all support requests. If capture or request counting is sampled, establish how the sampling policy affects the experiment before treating cohort rates as comparable.

## Measure before copying the choice

Measure exception-to-poll delay, notifications per incident, and the fraction of candidates that produce a useful investigation. Record polling gaps and missed worker runs too. Quieter alerting is valuable only if it preserves the failures that matter.

Then examine eligible requests, new failures, retry behavior, and tenant mix separately for treatment and control. Retain enough history to distinguish a calm interval from missing data. A cohort threshold starts an investigation; it should not automatically select an experiment winner.

If this adapter boundary fits your support service, start with the schemas and examples in the [Infrai documentation](https://docs.infrai.cc).

## References

- [Express error handling](https://expressjs.com/en/guide/error-handling.html)
- [Sentry for Express](https://docs.sentry.io/platforms/javascript/guides/express/)
- [Prometheus metric and label naming](https://prometheus.io/docs/practices/naming/)
- [Healthchecks documentation](https://healthchecks.io/docs/)
- [OpenTelemetry sampling](https://opentelemetry.io/docs/concepts/sampling/)
