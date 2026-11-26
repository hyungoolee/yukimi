import { checkRequest, newsStep, recheckAlert } from "./actions";
import { placeDailyCalls } from "./daily";
import { confirmStep, retryStep } from "./ladder";
import { deleteTask, listTasks, type Task } from "./store";

const run = (task: Task) => {
  if (task.kind === "ladder_retry") return retryStep(task.resident_id, task.ladder_at);
  if (task.kind === "ladder_confirm") return confirmStep(task.resident_id, task.ladder_at);
  if (task.kind === "request_check") return checkRequest(task);
  if (task.kind === "news_call") return newsStep(task);
  return recheckAlert(task);
};

let running = false;

/**
 * Runs every task that is due, then places the next daily call. Called every few seconds by instrumentation.ts.
 * A task is deleted after it runs, so a crash mid-task repeats it on restart instead of losing it;
 * each step checks the current state first, so a repeat is harmless.
 */
export async function runDue(now = Date.now()) {
  if (running) return;
  running = true;
  try {
    await runTasks(now);
    await placeDailyCalls(new Date(now)).catch((e) => console.error("Daily calls failed", e));
  } finally {
    running = false;
  }
}

async function runTasks(now: number) {
  const due = (await listTasks()).filter((t) => t.due <= now).sort((a, b) => a.due - b.due);
  for (const task of due) {
    await run(task).catch((e) => console.error(`Task ${task.id} failed`, e));
    await deleteTask(task.id);
  }
}

/**
 * Runs the tasks due now, at once, for a step that has just booked one (a helper's 行けません). One at a
 * time with the regular run: if that is under way, the task waits for its next pass, a few seconds on.
 */
export async function runDueTasksNow() {
  if (running) return;
  running = true;
  try {
    await runTasks(Date.now());
  } finally {
    running = false;
  }
}
