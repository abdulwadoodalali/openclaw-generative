# Ano iOS

Ano is a fully generative front end for OpenClaw: an Expo (React Native)
iPhone app that talks to the OpenClaw gateway on your Mac. **Build 1** is the Chat screen, the gateway
connection, threads and projects, and the AG-UI layer. **Build 2** adds generative UI: Ano's answers
can contain native components (cards, charts, task lists, components Ano defines itself) and a
dev-only demo thread to see them all. **v4** makes Ano a full chat app with a generative Home: Home is
a brief Ano writes (Needs you / Coming up) and you change by asking; Chat switches agent, model and
effort in one tap. **Canvases**: saved answers Ano keeps up to date, edited by asking, with versions,
restore and undo. **v5** ("chief of staff with a desk"): Home speaks first only when something needs a
decision, as a swipeable triage deck under a verdict line built from counts; an event-driven orb; the
Cobalt Desk palette.

- Expo SDK 57, React Native 0.86, React 19.2, expo-router, NativeWind v4 (react-native-reusables style).
- Gateway: the official `@openclaw/gateway-client` (browser entry) over React Native's WebSocket,
  with an Ed25519 device identity in the Keychain (`expo-secure-store`).
- Threads are OpenClaw sessions, projects are the session `category`.
- Every message goes through `OpenClawAgent` (an AG-UI `AbstractAgent`) hosted by CopilotKit's
  headless provider. Assistant text renders as markdown; `ano-ui` fences render as components.

## What you need

- A Mac running the OpenClaw gateway (it listens on `ws://127.0.0.1:18789`) and the `openclaw` CLI.
- [Tailscale](https://tailscale.com) on the Mac and the iPhone, in the same tailnet. Optional but
  recommended: Tailscale Serve in front of the gateway, so the phone reaches it as
  `wss://<your-mac>.<your-tailnet>.ts.net` at home and away.
- Expo Go on the iPhone.
- The pairing service in [`../../services/ano-pair`](../../services/ano-pair) running on the Mac, so the
  app pairs itself with no token to paste (see its README and `PAIRING.md`).

## First run

```bash
cd apps/ios
npm install --legacy-peer-deps
npm run prune                    # removes web-only packages CopilotKit pulls in, then clears the npm cache
cp .env.example .env             # then fill in your values (the file is gitignored)
```

## Configuration

Everything personal lives in `apps/ios/.env` (gitignored; `.env.example` lists every variable). Expo
reads `EXPO_PUBLIC_*` variables when it bundles, so restart Metro after a change. They end up in the
JS bundle: never put a token in them.

| Variable | Example | Unset |
| --- | --- | --- |
| `EXPO_PUBLIC_OPENCLAW_URL` | `wss://my-mac.example-tailnet.ts.net` | `ws://127.0.0.1:18789`; a device then uses the URL the pairing service hands back |
| `EXPO_PUBLIC_ANO_PAIR_HOST` | `my-mac.example-tailnet.ts.net` | Pairing discovery skips the MagicDNS candidate (it still tries the Metro host) |
| `EXPO_PUBLIC_ANO_USER_NAME` | `Alex` | Greeting is "Good evening", agent prompts say "the user" |
| `EXPO_PUBLIC_ANO_DEFAULT_AGENT` | `main` | `main` (OpenClaw's default agent) |

The agent picker in Settings, Chat and the canvas sheet lists the agents your gateway reports
(`agents.list`); the default agent is shown first, then `main`, then the rest.

## Run on the iPhone with Expo Go (over Tailscale)

1. On the Mac, in `apps/ios`, start Metro on the Mac's Tailscale IP (`tailscale ip -4`, for example
   `100.64.0.10`):

   ```bash
   REACT_NATIVE_PACKAGER_HOSTNAME=100.64.0.10 npx expo start --port 8081
   ```

2. On the iPhone, with Tailscale connected, open Expo Go, choose "Enter URL manually" and enter
   `exp://100.64.0.10:8081`.
3. The app pairs itself: it finds `ano-pair` (the address it remembers, then the Metro host, then
   `EXPO_PUBLIC_ANO_PAIR_HOST`), gets a one-time bootstrap token and the gateway URL, and stores a
   per-device token in the Keychain. You see a brief "Connecting to Ano" and then Home.
4. If automatic pairing fails, Settings opens. Fill the gateway URL (**Tailscale** fills
   `EXPO_PUBLIC_OPENCLAW_URL`) and paste the shared gateway token once; get it on the Mac in a real
   terminal with `openclaw gateway auth-token --show` (it refuses to print from a non-interactive
   shell). If the gateway wants the device approved, Settings shows "Waiting for approval" and the
   command to run on the Mac: `openclaw devices approve <id>`.

Expo Go only has Expo's bundled native modules. This app sticks to those on purpose. Shake the phone
for the dev menu; edits hot reload.

## Run in the browser (Expo web)

```bash
cd apps/ios
npx expo start --web --port 8081     # open http://localhost:8081, use a 390x844 viewport
```

Without `EXPO_PUBLIC_OPENCLAW_URL` the web preview uses **This Mac** (`ws://127.0.0.1:18789`); paste the
gateway token in Settings. On web the Ed25519 device identity and the device token live in plain
`localStorage` (there is no Keychain in a browser), so treat that browser profile as trusted and use
Reset pairing in Settings before handing it over. Stale mock URLs or tokens from an earlier session
also live there: clear the site data or use Reset pairing if the app points at the wrong gateway.
Pairing from a browser needs the gateway to accept the page origin. If the gateway rejects it the app
says so ("rejected this browser origin"); use Expo Go on the phone instead, or the offline mock below.
Do not change OpenClaw config for this.

For development you can pre-fill the URL and token from a gitignored `.env.local`:

```bash
./scripts/dev-env.sh            # or: ./scripts/dev-env.sh tailscale (uses EXPO_PUBLIC_ANO_PAIR_HOST)
```

It reads the token from the `openclaw` CLI without printing it. `EXPO_PUBLIC_*` values are baked into
the dev bundle, so delete `.env.local` when you are done. Never commit it (it is gitignored).

## Offline mock gateway

```bash
npm run mock-gateway             # ws://127.0.0.1:18790, token "mock-token"
```

Point Settings at `ws://127.0.0.1:18790` with token `mock-token` (on web a stale real-gateway token
or URL lives in `localStorage`: clear it or Reset pairing). It speaks the same wire protocol
(handshake, sessions and groups, streamed chat) and replies with canned markdown, so the whole app
can be exercised without the real gateway or an LLM. It needs Node with type stripping (Node 24+, or
22.6+ with `--experimental-strip-types`), because it imports the demo script from the app. Prompts:

- `budget this month`: a MoneyGlance (sample numbers) and a Suggestions row.
- `define`: an `ano-define` fence for a small `BudgetBar` component. The app registers it, saves it,
  and the next message of each thread that saw the older catalog carries a `[catalog-update]` for it.
- `use it` (after `define`): a `BudgetBar` instance drawn from that definition. Its `Open Groceries`
  button sends `[ui-event] {"component":"BudgetBar","event":"open","label":"Groceries"}`.
- `demo` (or `show me everything`): one long reply with every built-in, a user-defined component
  and a broken fence.
- `slow ...`: a run that takes about 8 seconds, to try Stop.
- Tapping a component sends a `[ui-event]`; the mock acknowledges it.

## Demo thread (dev only)

A recorded conversation that shows every generative UI component, with no gateway and no model, so
the UI can be judged on its own. A real `OpenClawAgent` (real fence transformer and renderers) runs
against `createDemoGateway`, an in-memory gateway that replays scripted replies as `chat` delta
events (about 40 ms per chunk), so what you see is exactly what a live reply draws.

- Open it from the empty thread's **Open demo thread** link, or go to `/demo` (on web
  `http://localhost:8081/demo`). It exists only when
  `__DEV__` is true: a production build redirects `/demo` to the chat.
- **Play next turn** sends the next scripted user message. **Replay all** starts a fresh demo session
  and plays all six turns. The thread is labelled "Demo thread - recorded, Sample data": every
  figure is made up.
- The six turns cover all 13 built-ins, one `ano-define` (`GroceryBudgetBars`) followed by a reply
  that uses it, and one deliberately broken fence that shows the fallback card.
- Taps inside the demo go to the demo agent. A Suggestions chip plays the turn with the same text,
  any other action (a ticked task, the Review groceries button, a tapped bar) sends a `[ui-event]`
  and gets a short scripted acknowledgement.
- The demo uses its own session key (`demo:<uuid>`), never a real thread, and never
  `agent:<id>:main`.

Files: `src/genui/demo/demoScript.ts` (the turns and the chunker), `demoGateway.ts`,
`DemoScreen.tsx`, `src/app/demo.tsx`.

## Checks

```bash
npx tsc --noEmit                                    # typecheck
npm test                                            # node tests: sessions API, AG-UI adapter, genui (parser, registry, interpreter, demo)
node scripts/check-device-identity.ts               # Ed25519 device signing sanity check
CI=1 npx expo export --platform ios --output-dir /tmp/ano-dist-ios     # Hermes bundle compiles
CI=1 npx expo export --platform web --output-dir /tmp/ano-dist-web     # web bundle compiles
OPENCLAW_TOKEN="$(openclaw gateway auth-token --show)" npm run smoke:live   # real round trip, see below
```

`npm test` runs `node --experimental-strip-types --test` over `src/openclaw`, `src/genui/**` and `src/canvas`. The
modules those tests import are pure TypeScript (no react, react-native or expo imports, explicit
`.ts` import extensions, erasable syntax only); keep them that way. One file: `node
--experimental-strip-types --test src/genui/demo/demoScript.test.ts`.

`smoke:live` runs the app's own gateway client, AG-UI agent and sessions API from Node against the
real gateway with a throwaway device identity and a throwaway session (archived at the end), on
`EXPO_PUBLIC_ANO_DEFAULT_AGENT` (default `main`). It creates a pairing record: afterwards run
`openclaw devices list` and `openclaw devices remove <id>` (the script prints the device id). Run it
only when you want a real turn sent to Ano.

`scripts/live-pair-e2e.ts <host:port>` (or `ANO_PAIR_HOST_URI`) pairs a throwaway identity through
the real `ano-pair` service, for example `node --experimental-strip-types scripts/live-pair-e2e.ts 100.64.0.10:8083`.

## Generative UI

Ano answers in Markdown. Fenced blocks inside the answer become native components (no WebView, no
HTML, no `eval`). Design notes: `../../notes/genui-and-threads.md` sections 2, 3 and 7; seams:
`../../handoff/BUILD2.md`.

**Fence format.** Two fence kinds, both with a single JSON object as the body:

````text
```ano-ui
{"component":"MoneyGlance","props":{"month":"October","spent":2190,"sample":true,"series":[12,18,24]}}
```

```ano-define
{"name":"GroceryBudgetBars","version":1,"description":"...","props":{...},"root":"root","nodes":{...}}
```
````

`src/genui/fenceTransformer.ts` (the `createFenceTransformer` hook of `OpenClawAgent`) turns each
complete fence into an AG-UI tool call: `render_<Name>` for `ano-ui`, `define_component` for
`ano-define`; the prose around the fences stays one markdown text message. While a fence is still
streaming the slot shows a skeleton. A fence that cannot be used (bad JSON, props that fail the
component's schema, more than 32 KB, unclosed at the end of the run) becomes a quiet fallback card
with the raw text, never a crash. Parsing lives in `src/genui/fences.ts`; the transformer is a pure
function of the full text, so streamed events and a reloaded thread produce the same message.

**The 13 built-ins** (`src/genui/builtins/`, drawn by `ToolCallSlot` through renderers registered
in the app). Ten are plain data rendered by the interpreter (`definitions.ts`): Card (holds other
components in `children`), Stack, Heading, Text, Badge, Stat, StatRow, Progress, TaskList,
Suggestions. Three are React code (`codeMeta.ts`, `src/genui/components/`, `src/genui/charts/`):
MoneyGlance, LineChart (1M / 3M / 1Y range switch) and BarChart. Charts and MoneyGlance take
`sample: true` to show a "Sample data" badge. Figures are never invented: label sample data.

**`ano-define`, primitives, bindings, limits.** Ano can define a new component as data
(`src/genui/definition.ts`, `registry.ts`). A definition is a tree of nodes: each node's `t` is one
of the 20 closed primitives (Stack, Grid, Card, Section, Text, Heading, Stat, Badge, Icon, Progress,
Chart, Image, Divider, Spacer, Pressable, Button, Segmented, Checkbox, List, Embed;
`src/genui/primitives/`) or another registered component. String fields take bindings (`bindings.ts`):
`{{prop}}`, `{{a.b}}`, `{{item.x}}` and `{{index}}` inside a List, `{{state.key}}`, with filters
`|money`, `|percent`, `|date`, `|upper`, `|round`; `"if":"{{x}}"` shows a node when truthy. Colors
are design tokens (`default accent household muted danger`), spacing is `0 4 8 12 16 24`, images
are https only. Actions are declared in `actions` (at most 8) and referenced by Button, Pressable,
Checkbox and Segmented nodes. Limits (`LIMITS` in `src/genui/types.ts`): 16 KB per definition, 32
KB per fence, 200 nodes, depth 8, props schema nesting 3. Built-ins cannot be redefined; a changed
component is resent with a higher `version` (or `replace: true`), and the previous version is kept
once for `revert`. Everything is validated with Zod before anything is drawn. Nodes are only ever
looked up in a fixed table of components, so there is no code path from model text to code.

**Catalog preamble and `[catalog-update]`.** The model only knows the components it was told about.
The first message of a thread carries an `<ano-ui-context>` brief (every component with its props,
the fence format, the primitives) in front of the typed text; the user bubble still shows only what
was typed. When the registry changes later (a new definition), the next message of each thread that
saw an older catalog carries a short `[catalog-update]` delta. `src/genui/catalog.ts` builds both,
`preamble.ts` tracks which catalog version each thread saw (persisted), `hooks.ts` and
`src/state/agentHooks.ts` plug them into `OpenClawAgent` (`decorateOutgoing` / `cleanIncoming`).

**`[ui-event]` round trip.** A tap inside a component calls the action handler
(`src/genui/actions.tsx`). A Suggestions chip is sent as an ordinary user message. Every other action
is sent as a user turn `[ui-event] {"component":"TaskList","event":"toggle","id":"t1"}`; those rows
are hidden in the thread and answered by Ano like any message. `formatUiEvent` and `parseUiEvent` in
`catalog.ts` are the two ends.

**Persistence and history rebuild.** Agent-defined components are stored on the device:
`ano/components.json` in the document directory via `expo-file-system` on iPhone, `localStorage` on
web (`src/genui/registryStorage.ts`), restored at startup by `registryInstance.ts`. A thread
reopened from history is rebuilt from the stored assistant text with the same transformer, so its
components render again, and `historyIngest.ts` feeds the `ano-define` fences found in loaded history
back into the registry (also after a fresh install). In-component state (a ticked checkbox, the chart
range) is local and not stored.

| Where | What |
| --- | --- |
| `src/genui/types.ts` | shared contract: constants, limits, `ComponentDefinition`, action types |
| `fences.ts`, `fenceTransformer.ts` | fence parsing and the AG-UI transformer |
| `definition.ts`, `registry.ts`, `registryInstance.ts`, `registryStorage.ts` | validation, versioned registry, app singleton, persistence |
| `bindings.ts`, `primitives/`, `DynamicComponent.tsx` | the interpreter |
| `builtins/`, `components/`, `charts/` | the 13 built-ins |
| `catalog.ts`, `preamble.ts`, `hooks.ts`, `historyIngest.ts` | catalog brief and delta, per-thread bookkeeping, agent hooks, history rebuild |
| `actions.tsx` | where taps go |
| `demo/` | recorded demo thread |

Prose and cards keep their order: the transformer leaves a `<!--ano:tcN-->` marker in the prose at
each fence (`proseMarkers.ts`) and `AssistantMarkdown` draws each card in place. `<details>` blocks in
a reply become native collapsible sections (cards inside them render too), the `Collapsible`
built-in does the same on purpose, and a component the registry does not know (or props that fail
validation) draws as a generic card built from its props (`genericView.ts`), with the source behind
a toggle. ```` ```ano-canvas ```` fences become `canvas_update` tool calls (see Canvases).

While a run is going, `RunActivityRow` shows the orb (`AnoOrb.tsx`) and what Ano is doing: thinking,
the tool or the agent it handed off to, the model answering (it changes on a fallback) and the
elapsed time. `OpenClawAgent` builds that `activity` state from the gateway's `agent` events.

## Orb

One global state machine drives every orb (`src/orb/orbMachine.ts`, pure and tested; store in
`orbStore.ts`). States, highest precedence first: offline, error, a run (thinking, working,
streaming), done, listening (the composer is focused), idle. The Composer, the chat's `OpenClawAgent`
and the gateway connection send it events (`orbSignal`); a canvas run passes `state` instead.
- Idle is still, with a glance every 7 to 12 s. Typing leans it in with a small impulse per key;
  thinking orbits the highlight (slower after 10 s); each tool start sends a ring and a satellite
  circles during the call; tokens pulse it; done exhales and draws a vermilion ring; error shakes.
- Reduce Motion: no movement, scale or tilt. Opacity, glow and colour still animate (with
  `ReduceMotion.Never`, or Reanimated skips them) and haptics carry done and error.
- Tilt: the highlight shifts up to 3 pt with the phone (`expo-sensors` DeviceMotion, `useTilt.ts`).

## Canvases

A canvas is a saved list of blocks (`{component, props}`, the same as an `ano-ui` fence) with a
version history, stored on the phone in `ano/canvases.json` (`src/canvas/store.ts`).

- **Home and Chat** are two pages of one pager (`HomeChatPager.tsx`, `src/lib/pager.ts`): swipe left
  for chat, right for Home. `/chat` redirects to the chat page.
- **Pin from any chat:** "Pin as canvas" under an answer with cards opens the pin sheet: a new canvas
  (locked by default) or "Add to existing" (`canvasStore.append`). The question the cards answered is
  kept as the canvas `origin`, which refresh uses. Ano can also save one itself with an `ano-canvas`
  fence `{"op":"create","title":...,"blocks":[...]}`.
- **Locked / unlocked:** a locked canvas does not change when tapped: a tap opens a new chat about
  that item (`src/lib/canvasAsk.ts`; the item's data travels in a hidden `<ano-tapped>` block). Unlocked,
  taps go to the canvas session as `[ui-event]` turns and "Change this canvas..." edits it.
- **Edit by asking** (`src/canvas/runner.ts`): each canvas has its own OpenClaw session (project
  "Canvases"). Every turn carries the current canvas (`buildCanvasContext`); Ano answers with one
  `ano-canvas` fence, either `{"summary","blocks"}` or a patch `{"summary","base","ops"}`
  (`patch.ts`). Each change is a new version; Undo and Restore add a version too, so nothing is lost.
  Runs live outside React, so a canvas keeps working while you move around the app.
- **Refresh:** the header button, pull down, or touch and hold a tile. Ano re-reads the figures from
  their sources; on a locked canvas only values may change (`keepLayout`). The canvas agent's refresh
  setting runs it by itself: when opened, hourly, or each morning (`refresh.ts`, `useAutoRefresh.ts`).
- **Canvas agent** ("who runs this canvas"): a name, what it should do, the model, which OpenClaw
  agent it runs on, and the refresh setting. The model is set on the canvas session with
  `sessions.patch {key, model}` (`null` = the agent's default). The phone cannot create OpenClaw
  agents or server cron jobs (both need `operator.admin`), so a canvas agent lives in the app.
- **Home** is a canvas with id `home` (kind `home`, never listed in Canvases). Ano writes it as
  `BriefItem` cards with a contract (`src/home/cards.ts`): `kind` (decide, answer, headsUp, today,
  handled, moving, tomorrow), a claim, `why` (why now), `stake` (mono, e.g. "$214", "Fri"), the agent,
  one action, `options` for answer cards. A decide, answer or headsUp card without a why or an action
  is not drawn. Layout (`homeLayout`): verdict line from counts (`src/home/verdict.ts`), Needs you as a
  triage deck, Heads-up, Today, Handled (receipts), Moving, other blocks, pinned canvases, Tomorrow
  after 18:00. An empty Needs you is a good day and is never padded.
- **Triage deck** (`TriageDeck.tsx`): swipe right does the card (its prompt opens a chat), left
  snoozes it until 18:00 (or 08:00 tomorrow), up hands it to its agent in the background; every swipe
  is also a button and a VoiceOver action. Snoozes and hand-offs persist in `ano/homeTriage.json`.
  The Home | Chat pager and Home's scroll wait for the deck's pan to fail (`src/lib/pagerGesture.ts`),
  so a sideways drag on a card moves the card, not the page.
- Change Home with Customize (a half sheet bound to the Home canvas runner) or from any chat: Ano
  answers with `{"canvas":"home",...}` and the chat shows a receipt with Undo / View. Chat updates are
  applied only while the reply streams, keyed by the update's content (`updateKey`), so reloading a
  chat never re-applies them. First open each day plays the "Morning Deal" (never hides cards for more
  than 1.5 s, never waits on the network).

## Chat

- **Who vs how.** The header is who you talk to: agent face, name and live status ("Here with you",
  "Thinking", the current step). Tap it to switch agent (starts a new chat with that agent). The
  composer chip is how Ano thinks: Quick / Balanced / Deep, or a custom model and effort
  (Low / Medium / High / Max). Model and effort apply to the open chat via `sessions.patch` and become
  the default for new chats. Hold send to pick a brain for one message only (`send(text, {once})`).
- **Composer:** `+` attaches up to 4 photos (library or camera, sent as `chat.send` attachments);
  messages typed while Ano works are queued ("Send now" steers the running reply); drafts survive stop
  and errors.
- **Transcript:** a "Thought for 8s · 3 steps" line opens the reasoning and steps; Copy / Retry / Pin
  under the latest answer and on long press; streaming keeps your question in view with a jump pill.
- **Sidebar:** search, Home, Canvases, pinned and recent chats across all agents.
## Palette (Cobalt Desk)

Tokens live in `theme.js` (shared by `src/theme.ts` and Tailwind); full table in `../../DESIGN.md`.

| Token | Value | Use |
| --- | --- | --- |
| `bg` / `surface` | `#F1F2F4` / `#FFFFFF` | Porcelain screen / cards |
| `ink` / `inkSecondary` | `#12141C` / `#565B68` | Text |
| `accent` | `#2B3AD6` | Ultramarine: user bubble, primary actions, links |
| `household` | `#3E6B2F` | Moss: household scope, success |
| `signal` | `#E8452C` | Vermilion: orb done ring and "needs you" dot only, never text |
| `shadow` / `scrim` | `#141A33` / 32% | Cool shadows, sheet and sidebar backdrop |

Vermilion is a signal, not a colour for content. Section labels use `type.label`: mono, sentence case, no tracking.
Components never use raw hex or rgba; add a token instead.

## Layout

```
src/app/                  expo-router routes: index (Home), chat, canvases, canvas/[id], demo (dev only)
src/screens/              Home, Chat, Canvases, Canvas screens (design/*.dc.html)
src/canvas/               canvas model, patches, store, protocol, edit-by-asking hook, canvas_update renderer
src/components/           Composer, MessageBubble, AssistantMarkdown, Sheet, SettingsSheet, ToolCallSlot,
                          chat/ (header, sheets, sidebar, transcript parts), home/ (Home parts), ui/
src/chat/                 agents, effort, models (quick picks), prefs, queue, turn (pure, tested)
src/state/                AnoProvider (wiring), threadsStore, gateway (platform deps), agentHooks
src/openclaw/             gatewayConnection, OpenClawAgent (AG-UI), sessionsApi, device identity
src/genui/                generative UI: fences, registry, interpreter, built-ins, demo (see Generative UI)
scripts/                  mock-gateway.mjs, live-smoke.ts, dev-env.sh, check-device-identity.ts
```

## Rules

No HTML widgets or WebViews, never advertise the gateway `inline-widgets` cap. Never use
`agent:<id>:main` (other channels such as Telegram share it): every app thread is its own session. "Delete" a
thread means archive (`sessions.delete` is admin only). Sample figures are labelled "Sample data".
