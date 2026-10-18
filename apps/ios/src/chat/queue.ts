// Messages typed while Ano is still answering wait here instead of being dropped (the outbox pattern).
//
//   send     idle: runs the turn now. A run is active: the turn is queued.
//   flush    when a turn ends well, the queue sends in order, one turn each.
//   failure  a failed turn pauses the queue (items are kept); resume() or the next send() continues it.
//   stop     the caller pauses the queue before aborting, so stopping never fires the next message.
//   sendNow  steers the running reply with a queued message instead of waiting for the turn to end.
//
// Nothing here clears a draft or drops a message on failure. Pure (no react / react-native / expo).
import type { SessionBrain } from './sessionPrefs.ts';
import type { PickedImage } from './types.ts';

/** `once`: run this message on another model and effort (the chat goes back afterwards). */
export type QueuedTurn = { id: string; text: string; images: PickedImage[]; once?: SessionBrain };

export type QueueState = {
  items: ReadonlyArray<QueuedTurn>;
  /** True when queued messages wait for resume() (a turn failed or was stopped). */
  paused: boolean;
};

export type QueueDeps = {
  /** True while the agent streams a run (also one this queue did not start). */
  isRunning(): boolean;
  /** Runs one turn to its end. Rejects when the turn failed. */
  run(turn: QueuedTurn): Promise<void>;
  /** Steers the running reply with this turn. Rejects when no run can take it. */
  steer(turn: QueuedTurn): Promise<void>;
  /** Shows a failure (run or steer) to the user. */
  onError(error: unknown): void;
  newId(): string;
};

export class SendQueue {
  private items: QueuedTurn[] = [];
  private paused = false;
  /** A turn started by this queue is running. */
  private busy = false;
  private state: QueueState = { items: [], paused: false };
  private readonly listeners = new Set<() => void>();
  private readonly deps: QueueDeps;

  constructor(deps: QueueDeps) {
    this.deps = deps;
  }

  getState = (): QueueState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(): void {
    this.state = { items: [...this.items], paused: this.paused && this.items.length > 0 };
    for (const l of [...this.listeners]) l();
  }

  private get active(): boolean {
    return this.busy || this.deps.isRunning();
  }

  /** Sends now when idle, else queues. Resolves when the turn (and anything flushed after it) ended. */
  async send(text: string, images: PickedImage[] = [], once?: SessionBrain): Promise<void> {
    const turn: QueuedTurn = once ? { id: this.deps.newId(), text, images, once } : { id: this.deps.newId(), text, images };
    if (this.active) {
      this.items.push(turn);
      this.publish();
      return;
    }
    if (this.items.length > 0) {
      // Messages are still waiting (paused): keep the order, and sending means "go on".
      this.items.push(turn);
      await this.resume();
      return;
    }
    if (this.paused) {
      this.paused = false;
      this.publish();
    }
    await this.runChain(turn);
  }

  /** Stops the queue from sending by itself until resume(). Call it before aborting a run. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.publish();
  }

  /** Continues a paused queue. */
  async resume(): Promise<void> {
    this.paused = false;
    this.publish();
    if (this.active) return; // flushed when the running turn ends
    await this.flush();
  }

  /** Call when a run this queue did not start has ended: sends what is waiting. */
  async flush(): Promise<void> {
    if (this.paused || this.active) return;
    const next = this.items.shift();
    if (!next) return;
    this.publish();
    await this.runChain(next);
  }

  /** Removes a queued message and returns it (so its text can go back into the field). */
  dequeue(id: string): QueuedTurn | undefined {
    const found = this.items.find((t) => t.id === id);
    if (!found) return undefined;
    this.items = this.items.filter((t) => t !== found);
    this.publish();
    return found;
  }

  /** Steers the running reply with a queued message (idle: just sends it). The message leaves the queue. */
  async sendNow(id: string): Promise<void> {
    const index = this.items.findIndex((t) => t.id === id);
    if (index < 0) return;
    const [turn] = this.items.splice(index, 1);
    this.publish();
    if (!this.active) {
      await this.runChain(turn);
      return;
    }
    try {
      await this.deps.steer(turn);
    } catch (e) {
      this.items.splice(index, 0, turn);
      this.publish();
      this.deps.onError(e);
    }
  }

  /** The chat changed: queued messages belong to the old chat. */
  reset(): void {
    this.items = [];
    this.paused = false;
    this.publish();
  }

  private async runChain(first: QueuedTurn): Promise<void> {
    let turn: QueuedTurn | undefined = first;
    while (turn) {
      if (!(await this.runOne(turn))) return;
      turn = this.paused ? undefined : this.items.shift();
      if (turn) this.publish();
    }
  }

  /** True when the turn ended well. A failure pauses the queue. */
  private async runOne(turn: QueuedTurn): Promise<boolean> {
    this.busy = true;
    try {
      await this.deps.run(turn);
      return true;
    } catch (e) {
      this.paused = true;
      this.publish();
      this.deps.onError(e);
      return false;
    } finally {
      this.busy = false;
    }
  }
}
