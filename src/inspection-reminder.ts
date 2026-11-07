import { infrai } from "./infrai-client.js";

const task = process.env.INSPECTION_TASK_URL;
if (!task) throw new Error("INSPECTION_TASK_URL is required");

const job = await infrai.cron.create(
  { cron_expr: "0 9 * * 1", task },
  "weekly-property-inspection-reminder",
);

console.log(JSON.stringify({ jobId: job.job_id, schedule: "Monday 09:00" }));
