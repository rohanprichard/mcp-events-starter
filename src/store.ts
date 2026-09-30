import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type Subscription = {
  id: string;
  owner: string;
  name: "task.created";
  arguments: { project_id?: string };
  url: string;
  secret: string;
  previousSecret?: string;
  rotationExpiresAt?: string;
  refreshBefore: string;
  active: boolean;
};

export class Store {
  private subscriptions = new Map<string, Subscription>();
  constructor(private readonly file: string) {}

  async load() {
    try {
      const values = JSON.parse(await readFile(this.file, "utf8")) as Subscription[];
      for (const value of values) this.subscriptions.set(value.id, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  get(id: string) { return this.subscriptions.get(id); }
  all() { return [...this.subscriptions.values()]; }

  async put(value: Subscription) {
    this.subscriptions.set(value.id, value);
    await this.save();
  }

  async remove(id: string) {
    this.subscriptions.delete(id);
    await this.save();
  }

  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(this.all(), null, 2), { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
