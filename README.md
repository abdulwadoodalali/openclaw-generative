# openclaw-generative

**Ano: a fully generative front end for [OpenClaw](https://docs.openclaw.ai).** An iPhone app (Expo,
runs in Expo Go) where almost nothing on screen is hard-coded: your agents write the Home screen, the
cards in a reply, the components they need, and the living documents they keep for you.

It talks to your own OpenClaw gateway over its wire protocol, so your agents, tools, memory and models
stay on your machine. The phone is just the face.

## What is generative

- **Home is written by your agents.** Each morning the gateway's agent rebuilds Home from your real
  data as a set of cards with a contract: a claim, why it matters now, what is at stake, and one action.
  Vague cards are dropped by the renderer. Change Home by asking ("add a card for my budget") from
  any chat.
- **Chief of staff, not a feed.** Home speaks first only when something needs a decision. A verdict line
  computed from counts ("2 things need you · 5 handled") sits above a swipeable triage deck: right to do
  it, left to snooze until tonight, up to hand it to the agent in the background. Then heads-up cards,
  today, receipts of what your agents did, and tomorrow (after 6 pm). An empty Home is a good day and is
  never padded.
- **Generative UI in chat.** Replies can contain native components through `ano-ui` fences: cards,
  charts, stat rows, task lists, money glances, collapsible sections. An agent can define a new component
  with `ano-define` and use it in the same reply. Unknown components fall back to a generic card built
  from their props, so nothing breaks.
- **Canvases.** Any answer can become a living document the agent keeps up to date (`ano-canvas` patches),
  with versions, restore, undo, locking, and its own canvas agent and refresh schedule.
- **Presence.** An event-driven orb: still when idle, leans in while you type, orbits while thinking,
  rings for each tool call, pulses with streamed tokens, exhales when done. Under Reduce Motion it stays
  alive through glow and colour only.

Also a full chat client: threads across all agents, search, pinning, photo attachments, queued
messages, per-chat model and effort switching (Quick / Balanced / Deep or any model the gateway offers),
agent switching, and a step-by-step view of what the agent did.

## Layout

```
apps/ios/              The app: Expo SDK 57, React Native 0.86, expo-router, NativeWind, Reanimated
  src/openclaw/        Gateway client, AG-UI agent over the OpenClaw protocol, pairing
  src/genui/           Generative UI: fences, component registry, built-ins, ano-define
  src/canvas/          Canvases: store, patch protocol, runners
  src/home/            Home card contract, layout, verdict, triage (pure, tested)
  src/orb/             Orb state machine (pure, tested)
services/ano-pair/     Optional pairing service: pairs the phone over Tailscale with no tokens to paste
```

## Run it

You need an OpenClaw gateway running on a Mac, Node 22.6+ (24 recommended), and Expo Go on your iPhone.

```sh
cd apps/ios
npm install
cp .env.example .env      # gateway URL, optional pairing host, your name, default agent
npx expo start --go       # scan the QR code with the iPhone camera
```

Reaching the gateway from the phone works best over [Tailscale](https://tailscale.com) (`tailscale serve`
in front of the gateway). With the optional pairing service the phone pairs itself on first launch;
otherwise paste the gateway token once in Settings and the app keeps its own device key afterwards.
See `apps/ios/README.md` and `services/ano-pair/PAIRING.md`.

For a look without a gateway: `npm run mock-gateway`, then point the app at `ws://127.0.0.1:18790`
(token `mock-token`) and ask for "demo".

## Checks

```sh
cd apps/ios && npx tsc --noEmit && npm test
cd services/ano-pair && npm test
```

## Licence

MIT, see [LICENSE](LICENSE).
