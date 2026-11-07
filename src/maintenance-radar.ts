import { createServer } from "node:http";
import { z } from "zod";
import { infrai } from "./infrai-client.js";

const reminderSchema = z.object({
  propertyId: z.string().min(1),
  inspectionAt: z.string().datetime(),
  taskUrl: z.string().url(),
});

type VisibilitySnapshot = {
  runs: unknown;
  deadLetters: unknown;
  capturedErrors: unknown;
};

export function needsAttention(snapshot: VisibilitySnapshot): boolean {
  return JSON.stringify(snapshot.runs).includes("failed")
    || JSON.stringify(snapshot.deadLetters).includes("message_id")
    || JSON.stringify(snapshot.capturedErrors).includes("error");
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) text += String(chunk);
  return JSON.parse(text);
}

async function visibility(jobId: string, queue: string): Promise<VisibilitySnapshot> {
  const [runs, deadLetters, capturedErrors] = await Promise.all([
    infrai.cron.runs.list(jobId),
    infrai.queue.dlq.list(queue),
    infrai.errors.groups(),
  ]);
  return { runs, deadLetters, capturedErrors };
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/inspection-reminders") {
      const input = reminderSchema.parse(await readJson(request));
      const job = await infrai.cron.create(
        { cron_expr: "0 9 * * 1", task: input.taskUrl },
        `inspection-${input.propertyId}-${input.inspectionAt}`,
      );
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ propertyId: input.propertyId, inspectionAt: input.inspectionAt, jobId: job.job_id }));
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/visibility?")) {
      const query = new URL(request.url, "http://localhost").searchParams;
      const jobId = query.get("jobId");
      const queue = query.get("queue");
      if (!jobId || !queue) throw new Error("jobId and queue are required");
      const snapshot = await visibility(jobId, queue);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ attention: needsAttention(snapshot), ...snapshot }));
      return;
    }
    response.writeHead(404).end();
  } catch (error) {
    await infrai.errors.capture(error);
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Invalid property maintenance request" }));
  }
});

if (process.argv[1]?.endsWith("maintenance-radar.ts")) {
  server.listen(Number(process.env.PORT ?? 3000));
}

export { server, visibility };
