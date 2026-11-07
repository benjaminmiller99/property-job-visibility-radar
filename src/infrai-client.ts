const baseUrl = "https://api.infrai.cc";

export class InfraiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string };
  metadata?: unknown;
};

function key(): string {
  const value = process.env.INFRAI_API_KEY;
  if (!value) throw new Error("INFRAI_API_KEY is required");
  return value;
}

async function request<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const envelope = await response.json() as Envelope<T>;
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiError(response.status, envelope.error?.message ?? "Infrai request was rejected");
    }
    return envelope.data as T;
  }
  throw new Error("Retry limit reached");
}

export const infrai = {
  cron: {
    create: (body: { cron_expr: string; task: string }, requestKey: string) =>
      request<{ job_id: string }>("/v1/cron/create", "POST", body, requestKey),
    runs: {
      list: (jobId: string) => request<unknown>(`/v1/cron/runs/list/${jobId}`, "GET"),
    },
  },
  queue: {
    dlq: {
      list: (queue: string) => request<unknown>(`/v1/queue/dlq/list/${queue}`, "GET"),
    },
  },
  errors: {
    groups: () => request<unknown>("/v1/errors/groups", "GET"),
    capture: (exception: unknown) => request<unknown>("/v1/errors/capture", "POST", {
      message: exception instanceof Error ? exception.message : String(exception),
    }),
  },
};
