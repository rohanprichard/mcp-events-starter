import { randomUUID } from "node:crypto";
import { Events } from "./events.js";

export class DemoBoard {
  readonly tasks: { id: string; title: string; project_id: string; created_at: string }[] = [];
  constructor(private readonly events: Events) {}

  async create(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The task input is not valid.");
    const values = input as Record<string, unknown>;
    if (typeof values.title !== "string" || !values.title.trim() || values.title.length > 200 ||
      typeof values.project_id !== "string" || !values.project_id.trim() || values.project_id.length > 100 ||
      Object.keys(values).some((key) => key !== "title" && key !== "project_id")) {
      throw new Error("The task input is not valid.");
    }
    const task = { id: `task_${randomUUID()}`, title: values.title, project_id: values.project_id, created_at: new Date().toISOString() };
    this.tasks.push(task);
    await this.events.emitTask(task);
    return task;
  }
}
