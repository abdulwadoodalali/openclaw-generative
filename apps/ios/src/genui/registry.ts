// The component registry: built-ins plus agent-defined components, versioned, persisted, observable.
// Pure TypeScript (storage is injected, see registryStorage.ts).
import { z, type ZodTypeAny } from 'zod';
import { compilePropSchema, formatZodError, validateDefinition } from './definition.ts';
import {
  PRIMITIVES,
  type CodeComponentMeta,
  type ComponentDefinition,
  type JsonObject,
  type RegistryEntry,
} from './types.ts';

export type RegistryStorage = {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
};

export type PropsValidation = { ok: true; props: JsonObject } | { ok: false; error: string };

export type DefineResult = { ok: true; entry: RegistryEntry; changed: boolean } | { ok: false; error: string };

const StoredEntrySchema = z.object({ definition: z.unknown(), changedAt: z.number().int().min(0) });
type StoredEntry = z.infer<typeof StoredEntrySchema>;

const StoredSchema = z.object({
  catalogVersion: z.number().int().min(0),
  entries: z.array(StoredEntrySchema),
  previous: z.array(StoredEntrySchema).default([]),
});

export class ComponentRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly previous = new Map<string, RegistryEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly schemas = new WeakMap<RegistryEntry, ZodTypeAny>();
  private readonly storage: RegistryStorage | undefined;
  private version = 0;
  private pendingSave: Promise<void> = Promise.resolve();

  /** Throws when a built-in is malformed: that is a bug in the app bundle, not a runtime condition. */
  constructor(opts: { builtins: ComponentDefinition[]; codeBuiltins: CodeComponentMeta[]; storage?: RegistryStorage }) {
    this.storage = opts.storage;
    for (const definition of opts.builtins) {
      this.addBuiltin({
        name: definition.name,
        version: definition.version,
        description: definition.description,
        props: definition.props,
        builtin: true,
        definition,
        changedAt: 0,
      });
    }
    for (const meta of opts.codeBuiltins) {
      this.addBuiltin({ name: meta.name, version: 1, description: meta.description, props: meta.props, builtin: true, changedAt: 0 });
    }
    for (const entry of this.entries.values()) {
      if (!entry.definition) continue;
      const checked = validateDefinition(entry.definition, (name) => this.entries.get(name));
      if (!checked.ok) throw new Error(`Built-in component "${entry.name}" is invalid: ${checked.error}`);
    }
  }

  private addBuiltin(entry: RegistryEntry): void {
    if (this.entries.has(entry.name)) throw new Error(`Duplicate built-in component "${entry.name}"`);
    this.schemas.set(entry, compilePropSchema(entry.props));
    this.entries.set(entry.name, entry);
  }

  get catalogVersion(): number {
    return this.version;
  }

  /** True when the registry holds agent-defined (non-builtin) components. */
  get hasUserDefinitions(): boolean {
    for (const entry of this.entries.values()) if (!entry.builtin) return true;
    return false;
  }

  get(name: string): RegistryEntry | undefined {
    return this.entries.get(name);
  }

  /** Built-ins first (registration order), then agent-defined components (first definition order). */
  list(): RegistryEntry[] {
    return [...this.entries.values()];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Validates an untrusted definition and registers it per the versioning rules (notes 7.2). */
  define(input: unknown): DefineResult {
    const name = typeof input === 'object' && input !== null && 'name' in input && typeof input.name === 'string' ? input.name : null;
    const existing = name === null ? undefined : this.entries.get(name);
    if (name !== null && (existing?.builtin || (PRIMITIVES as readonly string[]).includes(name))) {
      return { ok: false, error: `"${name}" is built in and cannot be redefined; pick a new name such as "${name}V2"` };
    }
    const checked = validateDefinition(input, (n) => this.entries.get(n));
    if (!checked.ok) return checked;
    const { definition } = checked;
    const current = this.entries.get(definition.name);
    if (current && definition.version <= current.version && !definition.replace) {
      return { ok: true, entry: current, changed: false };
    }
    if (current) this.previous.set(current.name, current);
    this.version += 1;
    const entry: RegistryEntry = {
      name: definition.name,
      version: definition.version,
      description: definition.description,
      props: definition.props,
      builtin: false,
      definition,
      changedAt: this.version,
    };
    this.entries.set(entry.name, entry);
    this.changed();
    return { ok: true, entry, changed: true };
  }

  /** Restores the single kept previous version of a user component. False when there is none. */
  revert(name: string): boolean {
    const previous = this.previous.get(name);
    if (!previous) return false;
    this.previous.delete(name);
    this.version += 1;
    this.entries.set(name, { ...previous, changedAt: this.version });
    this.changed();
    return true;
  }

  /** Validates instance props against the component's schema; null when the component is unknown. */
  validateProps(name: string, props: JsonObject): PropsValidation | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    let schema = this.schemas.get(entry);
    if (!schema) {
      schema = compilePropSchema(entry.props);
      this.schemas.set(entry, schema);
    }
    const parsed = schema.safeParse(props);
    if (!parsed.success) return { ok: false, error: formatZodError(parsed.error) };
    return { ok: true, props: parsed.data };
  }

  /**
   * Restores persisted user definitions. Never rejects: garbage or unreadable storage leaves the
   * registry as it is. Definitions are re-validated, so a stored entry that no longer passes is dropped.
   */
  async load(): Promise<void> {
    if (!this.storage) return;
    let stored: z.infer<typeof StoredSchema>;
    try {
      const raw = await this.storage.load();
      if (raw === null) return;
      stored = StoredSchema.parse(JSON.parse(raw));
    } catch {
      return;
    }

    // Entries may compose each other, so retry until a pass makes no progress.
    let pending: StoredEntry[] = stored.entries;
    for (let progressed = true; progressed && pending.length > 0; ) {
      const remaining = pending.filter((item) => !this.restore(item));
      progressed = remaining.length < pending.length;
      pending = remaining;
    }
    for (const item of stored.previous) {
      const checked = validateDefinition(item.definition, (name) => this.entries.get(name));
      if (!checked.ok || this.entries.get(checked.definition.name)?.builtin) continue;
      if (this.previous.has(checked.definition.name)) continue;
      this.previous.set(checked.definition.name, this.toEntry(checked.definition, item.changedAt));
    }

    this.version = Math.max(this.version, stored.catalogVersion);
    this.notify();
  }

  /** Resolves when every pending save has finished (tests, app shutdown). */
  flush(): Promise<void> {
    return this.pendingSave;
  }

  /** Registers one stored entry; false when it is invalid, already present, or not yet resolvable. */
  private restore(item: StoredEntry): boolean {
    const checked = validateDefinition(item.definition, (name) => this.entries.get(name));
    if (!checked.ok || this.entries.has(checked.definition.name)) return false;
    this.entries.set(checked.definition.name, this.toEntry(checked.definition, item.changedAt));
    return true;
  }

  private toEntry(definition: ComponentDefinition, changedAt: number): RegistryEntry {
    return {
      name: definition.name,
      version: definition.version,
      description: definition.description,
      props: definition.props,
      builtin: false,
      definition,
      changedAt,
    };
  }

  private changed(): void {
    this.persist();
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private persist(): void {
    const storage = this.storage;
    if (!storage) return;
    const toStored = (entry: RegistryEntry): StoredEntry => ({ definition: entry.definition, changedAt: entry.changedAt });
    const json = JSON.stringify({
      catalogVersion: this.version,
      entries: [...this.entries.values()].filter((entry) => !entry.builtin).map(toStored),
      previous: [...this.previous.values()].map(toStored),
    });
    // Saves are chained so an older snapshot can never overwrite a newer one; failures are swallowed.
    this.pendingSave = this.pendingSave.then(() => storage.save(json)).catch(() => undefined);
  }
}
