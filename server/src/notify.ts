// Phone notifications via ntfy (default) or a Discord webhook. Batched so a
// busy village never spams you: at most one message per minute.

const FLUSH_MS = 60_000;

export class Notifier {
  private queue: string[] = [];
  private lastFlush = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private ntfyUrl?: string,
    private discordWebhook?: string,
  ) {}

  get enabled(): boolean {
    return !!(this.ntfyUrl || this.discordWebhook);
  }

  send(text: string): void {
    if (!this.enabled) return;
    this.queue.push(text);
    const since = Date.now() - this.lastFlush;
    if (since >= FLUSH_MS) void this.flush();
    else if (!this.timer) this.timer = setTimeout(() => void this.flush(), FLUSH_MS - since);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.queue.length === 0) return;
    const body = this.queue.join("\n");
    this.queue = [];
    this.lastFlush = Date.now();
    try {
      if (this.ntfyUrl) {
        await fetch(this.ntfyUrl, { method: "POST", headers: { Title: "Idle Village", Tags: "house" }, body });
      }
      if (this.discordWebhook) {
        await fetch(this.discordWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: body.slice(0, 1900) }),
        });
      }
    } catch (err) {
      console.warn("[notify] failed:", (err as Error).message);
    }
  }
}
