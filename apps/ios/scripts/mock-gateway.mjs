// Mock OpenClaw gateway for offline app testing.
//
// Usage: node scripts/mock-gateway.mjs
// Env:   MOCK_PORT (default 18790), MOCK_TOKEN (default "mock-token"), MOCK_TICK_MS (default 30000)
// Try:   "budget this month" (MoneyGlance), "define" (ano-define), "demo" or "show me everything"
//        (every built-in, a user-defined component and a broken fence, from src/genui/demo/demoScript.ts).
// Needs Node 22.6+ with type stripping (Node 24+ by default): it imports the app's pure TS modules.
//
// Speaks the OpenClaw wire protocol v4 subset the app uses (see
// notes/openclaw-protocol.md and notes/genui-and-threads.md sections 4/5):
// connect.challenge -> connect -> hello-ok, then req/res + chat streaming
// events, sessions/groups CRUD, and canned generative-UI replies.
// No signature verification, no real agent: any device block is accepted and
// MOCK_TOKEN (or the deviceToken "mock-device-token") authenticates.

import { randomUUID } from "node:crypto";
import pkg from "ws";
import { cleanUserText } from "../src/genui/catalog.ts";
import { DEMO_FULL_REPLY, chunkReply } from "../src/genui/demo/demoScript.ts";

// ws 7.x exposes the server as .Server; ws 8+ as .WebSocketServer. Support both.
const WebSocketServer = pkg.WebSocketServer ?? pkg.Server;

const ENV = process.env;
const PORT = Number(ENV.MOCK_PORT || 18790);
const authTok = ENV.MOCK_TOKEN || "mock-token";
const TICK_MS = Number(ENV.MOCK_TICK_MS || 30000);
const DEVICE_TOKEN = "mock-device-token";

const log = (...args) => console.log("[mock-gateway]", ...args);

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

function makeRow({ agentId, key, label, displayName, category, sessionId }) {
  const now = Date.now();
  const row = {
    key,
    kind: "direct",
    label,
    displayName: displayName ?? label,
    pinned: false,
    archived: false,
    updatedAt: now,
    lastActivityAt: now,
    unread: false,
    hasActiveRun: false,
    sessionId: sessionId ?? randomUUID(),
    agentId,
  };
  // category is absent (not null) on loose sessions, like the real gateway.
  if (category !== undefined && category !== null) row.category = category;
  return row;
}

const sessions = [];
const groups = [{ name: "Garden Planner", position: 0 }];
// sessionKey -> { messages: [], seq: number }
const histories = new Map();
// idempotencyKey -> runId (so a retry never starts a second run)
const idempotency = new Map();
// runId -> run state (for abort + inFlightRun reporting)
const runs = new Map();

function historyFor(sessionKey) {
  let h = histories.get(sessionKey);
  if (!h) {
    h = { messages: [], seq: 0 };
    histories.set(sessionKey, h);
  }
  return h;
}

function appendMessage(sessionKey, role, content) {
  const h = historyFor(sessionKey);
  h.seq += 1;
  h.messages.push({
    role,
    content,
    timestamp: Date.now(),
    __openclaw: { id: randomUUID(), seq: h.seq },
  });
  const row = sessions.find((s) => s.key === sessionKey);
  if (row) {
    row.updatedAt = Date.now();
    row.lastActivityAt = row.updatedAt;
  }
}

function ensureRow(sessionKey) {
  let row = sessions.find((s) => s.key === sessionKey);
  if (!row) {
    // The real gateway creates a session on first chat.send to a fresh key.
    const agentId = sessionKey.startsWith("agent:")
      ? sessionKey.split(":")[1]
      : "main";
    row = makeRow({ agentId, key: sessionKey, label: sessionKey });
    sessions.push(row);
  }
  return row;
}

// Seed: one session inside the "Garden Planner" project, one loose session.
{
  const garden = makeRow({
    agentId: "main",
    key: "agent:main:dashboard:seed-garden",
    label: "Seed order follow-up",
    displayName: "Seed order follow-up",
    category: "Garden Planner",
  });
  const loose = makeRow({
    agentId: "main",
    key: "agent:main:dashboard:seed-loose",
    label: "Quick questions",
    displayName: "Quick questions",
  });
  sessions.push(garden, loose);
  appendMessage(garden.key, "user", "Draft the seed order for the spring beds.");
  appendMessage(
    garden.key,
    "assistant",
    [{ type: "text", text: "**Ano** Drafted a short seed order for the spring beds, ready in your notes under `garden/seeds`." }],
  );
  appendMessage(loose.key, "user", "Where did I put the passport photos?");
  appendMessage(
    loose.key,
    "assistant",
    [{ type: "text", text: "**Ano** They are in the **Travel** area of the vault, filed as `assets/passport-2026`." }],
  );
}

function labelTaken(label, exceptKey) {
  // Labels are unique and case sensitive, like the real gateway.
  return sessions.some((s) => s.label === label && s.key !== exceptKey);
}

// ---------------------------------------------------------------------------
// Canned assistant replies (always start with the "**Ano** " persona prefix)
// ---------------------------------------------------------------------------

const MONEY_GLANCE_FENCE = [
  "```ano-ui",
  JSON.stringify({
    component: "MoneyGlance",
    props: {
      month: "October",
      spent: 2190,
      left: 410,
      cash: 8940,
      sample: true,
      series: [12, 18, 24, 30, 37, 45, 52, 61, 70, 78, 88, 97],
    },
  }),
  "```",
].join("\n");

const SUGGESTIONS_FENCE = [
  "```ano-ui",
  JSON.stringify({ component: "Suggestions", props: { options: ["By category", "Pin as canvas"] } }),
  "```",
].join("\n");

const DEFINE_FENCE = [
  "```ano-define",
  JSON.stringify({
    name: "BudgetBar",
    version: 1,
    description: "one category vs its budget",
    props: {
      type: "object",
      required: ["label", "spent", "budget"],
      properties: {
        label: { type: "string" },
        spent: { type: "number" },
        budget: { type: "number" },
      },
    },
    root: "n1",
    nodes: {
      n1: { t: "Card", children: ["n2", "n3"] },
      n2: { t: "Progress", value: "{{spent}}", max: "{{budget}}" },
      n3: { t: "Button", label: "Open {{label}}", variant: "secondary", action: { name: "open", payload: { label: "{{label}}" } } },
    },
    actions: ["open"],
  }),
  "```",
].join("\n");

function replyFor(sent) {
  // The app puts the <ano-ui-context> brief (it mentions budgets and "define") before the first
  // message of a thread, so match on what the user typed.
  const message = cleanUserText(sent).text.trimStart();
  if (message.startsWith("[ui-event]")) {
    return "**Ano** Got it, the component event was recorded. Nothing else to do for now.";
  }
  if (/demo|show me everything/i.test(message)) return DEMO_FULL_REPLY;
  if (/budget|month/i.test(message)) {
    return [
      "**Ano** Here is your October snapshot, with sample numbers for offline testing.",
      "",
      MONEY_GLANCE_FENCE,
      "",
      "Spending is **slightly ahead** of plan, mostly in groceries.",
      "",
      SUGGESTIONS_FENCE,
      "",
    ].join("\n");
  }
  if (/use it|budgetbar/i.test(message)) {
    return [
      "**Ano** Here is groceries with the component from earlier (sample numbers).",
      "",
      "```ano-ui",
      JSON.stringify({ component: "BudgetBar", props: { label: "Groceries", spent: 412, budget: 500 } }),
      "```",
    ].join("\n");
  }
  if (/define/i.test(message)) {
    return [
      "**Ano** Sure, here is a tiny reusable component for that.",
      "",
      DEFINE_FENCE,
      "",
      "Use it with a `BudgetBar` fence whenever you want a category bar.",
    ].join("\n");
  }
  return [
    "**Ano** Here is a **short** offline answer:",
    "",
    "- First, the mock gateway streams this text in small deltas",
    "- Second, markdown like `inline code` survives the round trip",
    "- Third, ask about the budget this month to see generative UI",
    "",
    "Send another message to keep testing `chat.send`.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chunk sizes cycle so text splits mid-word and across markdown fence
// boundaries, exercising the app's incremental fence parser.
const CHUNK_SIZES = [19, 3, 41, 9, 27, 5, 33];

function splitChunks(text) {
  const chunks = [];
  let i = 0;
  let sizeIdx = 0;
  while (i < text.length) {
    const size = CHUNK_SIZES[sizeIdx % CHUNK_SIZES.length];
    chunks.push(text.slice(i, i + size));
    i += size;
    sizeIdx += 1;
  }
  return chunks;
}

// Authenticated connections, for broadcasting chat events.
const liveConns = new Set();

function broadcastChat(payload) {
  for (const conn of liveConns) conn.sendEvent("chat", payload);
}

async function streamRun(run, fullText) {
  const slow = /slow/i.test(run.userMessage);
  // The long demo reply streams in the demo script's chunks, a little faster than the short ones.
  const isDemo = fullText === DEMO_FULL_REPLY;
  const chunks = isDemo ? chunkReply(fullText) : splitChunks(fullText);
  // A "slow" run stretches to ~8 s total so chat.abort can be tested.
  const intervalMs = slow ? Math.max(30, Math.round(8000 / chunks.length)) : isDemo ? 10 : 25;

  run.seq += 1;
  broadcastChat({
    runId: run.runId,
    sessionKey: run.sessionKey,
    agentId: run.agentId,
    seq: run.seq,
    state: "status",
    phase: "starting_model",
  });
  await sleep(slow ? 600 : 60);

  let acc = "";
  for (let i = 0; i < chunks.length; i++) {
    if (run.settled) return; // aborted (abort handler already emitted + finalized)
    acc += chunks[i];
    run.text = acc;
    run.seq += 1;
    const payload = {
      runId: run.runId,
      sessionKey: run.sessionKey,
      agentId: run.agentId,
      seq: run.seq,
      state: "delta",
      deltaText: chunks[i],
    };
    // The first delta also carries a full snapshot, like the real gateway.
    if (i === 0) {
      payload.message = { role: "assistant", content: [{ type: "text", text: acc }] };
    }
    broadcastChat(payload);
    await sleep(intervalMs);
  }

  if (run.settled) return;
  run.seq += 1;
  broadcastChat({
    runId: run.runId,
    sessionKey: run.sessionKey,
    agentId: run.agentId,
    seq: run.seq,
    state: "final",
    message: { role: "assistant", content: [{ type: "text", text: fullText }] },
  });
  finishRun(run, fullText);
}

// Called exactly once per run, on final or abort.
function finishRun(run, text) {
  if (run.settled) return;
  run.settled = true;
  runs.delete(run.runId);
  const row = sessions.find((s) => s.key === run.sessionKey);
  if (row) row.hasActiveRun = false;
  if (text) appendMessage(run.sessionKey, "assistant", [{ type: "text", text }]);
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

const ERR = (message, details) => ({
  code: "INVALID_REQUEST",
  message,
  ...(details ? { details } : {}),
});

function handleRequest(conn, frame) {
  const { id, method, params = {} } = frame;
  const ok = (payload) => conn.send({ type: "res", id, ok: true, payload });
  const fail = (error) => conn.send({ type: "res", id, ok: false, error });

  switch (method) {
    case "health":
      return ok({ ok: true });

    case "agents.list":
      return ok({
        defaultId: "main",
        mainKey: "main",
        scope: "per-sender",
        agents: [
          { id: "main", name: "Ano General" },
          { id: "finance", name: "Ano Finance" },
          { id: "notes", name: "Ano Notes" },
        ],
      });

    case "sessions.subscribe":
    case "sessions.messages.subscribe":
      return ok({ subscribed: true });

    case "sessions.list": {
      const { agentId, limit = 50, offset = 0, search } = params;
      let rows = sessions.filter((s) => !s.archived);
      if (agentId) rows = rows.filter((s) => s.agentId === agentId);
      if (search) {
        const q = String(search).toLowerCase();
        rows = rows.filter(
          (s) =>
            s.label.toLowerCase().includes(q) ||
            (s.displayName ?? "").toLowerCase().includes(q),
        );
      }
      rows.sort((a, b) => b.updatedAt - a.updatedAt);
      const page = rows.slice(offset, offset + limit);
      return ok({
        ts: Date.now(),
        count: page.length,
        totalCount: rows.length,
        hasMore: false,
        sessions: page,
      });
    }

    case "sessions.create": {
      const { agentId = "main", label, displayName, category } = params;
      if (label && labelTaken(label)) return fail(ERR("label already in use"));
      const key = `agent:${agentId}:dashboard:${randomUUID()}`;
      const row = makeRow({ agentId, key, label: label ?? key, displayName, category });
      sessions.push(row);
      historyFor(key);
      // Real payload spreads key/sessionId at the top level AND nests session.
      return ok({ ok: true, key, sessionId: row.sessionId, session: row });
    }

    case "sessions.patch": {
      const { key, label, category, pinned, archived, expectedSessionId, displayName } = params;
      const row = sessions.find((s) => s.key === key);
      if (!row) return fail(ERR("session not found"));
      if (expectedSessionId && expectedSessionId !== row.sessionId) {
        return fail(ERR("session id mismatch"));
      }
      if (label !== undefined && label !== row.label && labelTaken(label, key)) {
        return fail(ERR("label already in use"));
      }
      if (label !== undefined) {
        row.label = label;
        // displayName follows the label unless explicitly set, like the gateway.
        if (displayName === undefined) row.displayName = label;
      }
      if (displayName !== undefined) row.displayName = displayName;
      if ("category" in params) {
        if (category === undefined || category === null) delete row.category;
        else row.category = category;
      }
      if (pinned !== undefined) row.pinned = Boolean(pinned);
      if (archived !== undefined) row.archived = Boolean(archived);
      row.updatedAt = Date.now();
      return ok({ ok: true, key: row.key, sessionId: row.sessionId, session: row });
    }

    case "sessions.groups.list":
      return ok({ groups: [...groups].sort((a, b) => a.position - b.position), sectionOrder: [] });

    case "sessions.groups.put": {
      const names = Array.isArray(params.names) ? params.names : [];
      // Refuse to drop a group that still has member sessions.
      for (const g of groups) {
        if (!names.includes(g.name) && sessions.some((s) => s.category === g.name)) {
          return fail(ERR("group has members"));
        }
      }
      groups.length = 0;
      names.forEach((name, i) => groups.push({ name, position: i }));
      return ok({ groups: [...groups], sectionOrder: [] });
    }

    case "sessions.groups.rename": {
      const { name, to } = params;
      const g = groups.find((x) => x.name === name);
      if (!g) return fail(ERR("group not found"));
      g.name = to;
      let updatedSessions = 0;
      for (const s of sessions) {
        if (s.category === name) {
          s.category = to;
          updatedSessions += 1;
        }
      }
      return ok({ updatedSessions });
    }

    case "sessions.groups.delete": {
      const { name } = params;
      const idx = groups.findIndex((x) => x.name === name);
      if (idx === -1) return fail(ERR("group not found"));
      groups.splice(idx, 1);
      let updatedSessions = 0;
      for (const s of sessions) {
        if (s.category === name) {
          delete s.category;
          updatedSessions += 1;
        }
      }
      return ok({ ok: true, updatedSessions });
    }

    case "chat.history": {
      const { sessionKey, limit = 50 } = params;
      const row = sessions.find((s) => s.key === sessionKey);
      const h = historyFor(sessionKey);
      const messages = h.messages.slice(Math.max(0, h.messages.length - limit));
      const payload = {
        sessionKey,
        sessionId: row ? row.sessionId : null,
        messages,
        hasMore: false,
        totalMessages: h.messages.length,
      };
      // inFlightRun is present only while a run streams for this session.
      const active = [...runs.values()].find((r) => r.sessionKey === sessionKey);
      if (active) payload.inFlightRun = { runId: active.runId, text: active.text };
      return ok(payload);
    }

    case "chat.send": {
      const { sessionKey, message = "", idempotencyKey } = params;
      if (!sessionKey) return fail(ERR("sessionKey required"));

      // Retried idempotencyKey: same runId, no second run.
      if (idempotencyKey && idempotency.has(idempotencyKey)) {
        return ok({ runId: idempotency.get(idempotencyKey), status: "started" });
      }

      const row = ensureRow(sessionKey);
      const runId = randomUUID();
      if (idempotencyKey) idempotency.set(idempotencyKey, runId);
      appendMessage(sessionKey, "user", message);

      const run = {
        runId,
        sessionKey,
        agentId: row.agentId,
        userMessage: message,
        text: "",
        seq: 0,
        settled: false,
      };
      runs.set(runId, run);
      row.hasActiveRun = true;

      // Ack first, stream after (never block the response on the stream).
      ok({ runId, status: "started" });
      streamRun(run, replyFor(message)).catch((e) => {
        log("stream error", e?.message ?? e);
        finishRun(run, run.text);
      });
      return undefined;
    }

    case "chat.abort": {
      const { sessionKey, runId } = params;
      const run = runId ? runs.get(runId) : [...runs.values()].find((r) => r.sessionKey === sessionKey);
      ok({ ok: true, sessionKey, runId: run ? run.runId : runId ?? null });
      if (run && !run.settled) {
        run.seq += 1;
        broadcastChat({
          runId: run.runId,
          sessionKey: run.sessionKey,
          agentId: run.agentId,
          seq: run.seq,
          state: "aborted",
        });
        finishRun(run, run.text); // keep the partial text in history
      }
      return undefined;
    }

    default:
      return fail(ERR("unknown method"));
  }
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

const METHODS = [
  "health",
  "agents.list",
  "sessions.subscribe",
  "sessions.messages.subscribe",
  "sessions.list",
  "sessions.create",
  "sessions.patch",
  "sessions.groups.list",
  "sessions.groups.put",
  "sessions.groups.rename",
  "sessions.groups.delete",
  "chat.history",
  "chat.send",
  "chat.abort",
];

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });

wss.on("connection", (socket) => {
  const conn = {
    socket,
    authed: false,
    frameSeq: 0, // outer event seq resets per connection, like the real gateway
    send(obj) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(obj));
    },
    sendEvent(event, payload) {
      conn.frameSeq += 1;
      conn.send({ type: "event", event, payload, seq: conn.frameSeq });
    },
  };

  conn.sendEvent("connect.challenge", {
    nonce: randomUUID(),
    ts: Date.now(),
    capabilities: [],
  });

  let tickTimer = null;

  socket.on("message", (data) => {
    let frame;
    try {
      frame = JSON.parse(String(data));
    } catch {
      log("bad JSON frame dropped");
      return;
    }
    if (!frame || frame.type !== "req" || typeof frame.method !== "string") {
      if (!conn.authed) socket.close(4000, "first frame must be a connect req");
      return;
    }

    if (!conn.authed) {
      // The first client frame must be req method "connect".
      if (frame.method !== "connect") {
        conn.send({
          type: "res",
          id: frame.id,
          ok: false,
          error: ERR("first frame must be connect"),
        });
        socket.close(4000, "first frame must be connect");
        return;
      }
      log("req connect");
      const auth = frame.params?.auth ?? {};
      if (auth.token === authTok || auth.deviceToken === DEVICE_TOKEN) {
        conn.authed = true;
        liveConns.add(conn);
        conn.send({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            type: "hello-ok",
            protocol: 4,
            server: { version: "mock", connId: randomUUID() },
            features: {
              methods: METHODS,
              events: ["connect.challenge", "chat", "tick", "sessions.changed"],
            },
            snapshot: {
              sessionDefaults: {
                defaultAgentId: "main",
                mainKey: "main",
                mainSessionKey: "agent:main:main",
                scope: "per-sender",
              },
            },
            auth: {
              method: "token",
              role: "operator",
              scopes: ["operator.read", "operator.write"],
              deviceToken: DEVICE_TOKEN,
              issuedAtMs: Date.now(),
            },
            policy: {
              maxPayload: 26214400,
              maxBufferedBytes: 52428800,
              tickIntervalMs: TICK_MS,
            },
          },
        });
        tickTimer = setInterval(() => conn.sendEvent("tick", {}), TICK_MS);
      } else {
        // Never log the token itself.
        conn.send({
          type: "res",
          id: frame.id,
          ok: false,
          error: ERR("unauthorized", { code: "AUTH_TOKEN_MISMATCH" }),
        });
        socket.close(4000, "unauthorized");
      }
      return;
    }

    // Authenticated requests. Log one line per method, never tokens.
    const safe = [frame.params?.sessionKey, frame.params?.key, frame.params?.agentId]
      .filter((x) => typeof x === "string")
      .join(" ");
    log(`req ${frame.method}${safe ? " " + safe : ""}`);
    handleRequest(conn, frame);
  });

  socket.on("close", () => {
    liveConns.delete(conn);
    clearInterval(tickTimer);
  });
  socket.on("error", () => {
    liveConns.delete(conn);
    clearInterval(tickTimer);
  });
});

wss.on("listening", () => {
  console.log(
    `mock gateway listening on ws://127.0.0.1:${PORT} (token via MOCK_TOKEN, default mock-token)`,
  );
});

wss.on("error", (err) => {
  console.error("[mock-gateway] server error:", err.message);
  process.exit(1);
});
