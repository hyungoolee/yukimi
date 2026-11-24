import { recheckAlert } from "./actions";
import { confirmStep, retryStep } from "./ladder";
import { deleteTask, listTasks, type Task } from "./store";

const run = (task: Task) => {
  if (task.kind === "ladder_retry") return retryStep(task.resident_id, task.ladder_at);
  if (task.kind === "ladder_confirm") return confirmStep(task.resident_id, task.ladder_at);
  return recheckAlert(task.call_id ?? "", task.round ?? 1);
};

let running = false;

/**
 * Runs every task that is due. Called every few seconds by instrumentation.ts.
 * A task is deleted after it runs, so a crash mid-task repeats it on restart instead of losing it;
 * each step checks the current state first, so a repeat is harmless.
 */
export async function runDue(now = Date.now()) {
  if (running) return;
  running = true;
  try {
    const due = (await listTasks()).filter((t) => t.due <= now).sort((a, b) => a.due - b.due);
    for (const task of due) {
      await run(task).catch((e) => console.error(`Task ${task.id} failed`, e));
      await deleteTask(task.id);
    }
  } finally {
    running = false;
  }
}
