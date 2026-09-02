# DuePoint — an AI agent that collects overdue invoices from your customers' AP portals

Large buyers make suppliers invoice and check status through the **buyer's** portal — Ariba,
Coupa, Tungsten, or something built in-house in 2009. The supplier gets no API, because it
isn't their system. Collectors log into each portal, hunt for the invoice, read a status
worded differently everywhere, and re-key it into their own AR system.

DuePoint does that job: one AI agent per customer, each on its own **Solari cloud browser**,
working four completely different portal UIs in parallel — no portal-specific code — with a
human approving anything that could concede money.

**[▶ Watch the demo video](video/out/duepoint-demo.mp4)** — rendered from a real run (see [The demo video](#the-demo-video)).

## Quickstart

You need two things: a **Codex login** (the agent — uses your ChatGPT plan, no model API key)
and a **Solari API key** (the infrastructure).

```bash
cd examples/ar-portal-collections
npm install
npx playwright install chromium

codex login                          # 1. the agent  (or: export CODEX_API_KEY=...)
export SOLARI_API_KEY=slr_live_...   # 2. the infra  (getsolari.com)

npm run host:start                   # portals + AR system → a Solari sandbox, public preview URL
npm run demo:solari                  # dashboard at http://127.0.0.1:4310 — click “Check portals”
```

Four agents fan out across the portals on Solari cloud browsers; ~3 minutes later the queue is
worked, six invoices wait for your approval, and every invoice links to its Solari session
replays. Run `npm run host:stop` when you're done (the sandbox bills while it runs).

**No Solari key yet?** `npm run demo:agent` runs the identical thing on local browsers.
**No Codex either?** `npm run demo` uses deterministic scripted flows — zero accounts needed.

## What you're looking at

```text
Overdue_Invoices.xlsx  (24 invoices · 5 customers · $433K past due)
        │
        ├── SupplierNet   (Meridian Manufacturing)   enterprise supplier network: filters → table → drill-down
        ├── ProcureHub    (Atlas Retail Group)       SaaS P2P suite: global search → drawer → confirm dialogs
        ├── TradeLink     (Halvorsen Logistics)      e-invoicing network: buyer-gated lookup → status timeline
        ├── Vendor Center (Crestview Health)         homegrown legacy portal: scan a table → plain forms
        └── (no portal)   (Brightwater Foods)        held for a manual statement
        │          all four portals worked in parallel — one agent, one cloud browser, per customer
        ▼
   Paid → match remittance · Approved → record promise · Pending → request status
   Not received → resubmit · Rejected → correct & resubmit · Disputed → human approval
        ▼
   Corvus AR (legacy receivables workstation) updated with status, reference and note
```

In our runs the agent read **22/22** portal findings correctly and completed all 10 portal
actions — $93K confirmed, $204K unblocked in 324 seconds.

## How Solari is used

| Solari | Role |
| --- | --- |
| **Sandbox** | Hosts the “outside world” — the four portals and Corvus AR — on a public preview URL (`npm run host:start`) |
| **Browser × 4 (hosted MCP)** | Each Codex agent creates its own recorded cloud browser and works its portal through `solari_browser_*` tools |
| **Browser (SDK)** | The fixed Corvus AR posting flow runs in a recorded Solari browser |
| **Replays** | Every session is recorded; each invoice links to its portal-check, portal-action and AR replays (`/api/replay/:sessionId`) |

## How the agent works

**Policy in code, perception and execution by the agent.**

- `src/domain.ts` — what to do per portal finding, and what stops for a human: disputes,
  no-portal accounts, anything ≥ $50K, anything the agent couldn't determine.
- `src/codex-agent.ts` — runs `codex exec` per customer with a goal (*“check these invoices in
  this portal, tell me what it shows”*) and MCP browser tools. No portal-specific code: it
  explores navigation, reads the portal's own wording, maps it to a finding. A second turn on
  the same thread executes the actions.
- `src/portal-adapters.ts` — a deterministic Playwright flow per portal, kept as the **test
  fixture** and as ground truth to score the agent (that's where 22/22 comes from). The mocks
  expose test ids only for the fixture; the agent sees pages like a person would.

## All commands

| Command | What it does |
| --- | --- |
| `npm run demo` | Scripted flows, visible local browsers — no accounts needed |
| `npm run demo:agent` | Codex agents on local browsers (Playwright MCP) |
| `npm run demo:solari` | Codex agents on Solari cloud browsers, AR posting on Solari |
| `npm run host:start` / `host:status` / `host:refresh` / `host:logs` / `host:stop` | Sandbox hosting the portals (preview tokens last ~1h — `host:refresh` before demos) |
| `npm run smoke:codex` | 20s end-to-end check: Codex → MCP → browser → structured output (`BROWSER_MCP=solari` for the cloud path) |
| `npm test` / `npm run typecheck` | Policy + agent-prompt unit tests, full scripted E2E across every portal |

## The demo video

Cut from real run data, not hand-animated — marks become cuts, the run's length computes the
speed ramp, the outro counters animate the actual summary:

```bash
npm run record:demo      # record dashboard + portal B-roll against a live run
npm run video:timeline   # recording → edit decisions
npm run video:render     # Remotion → video/out/duepoint-demo.mp4 (4K)
```

Music: “Phase Shift” by Scott Buckley (scottbuckley.com.au), CC BY 4.0 — drop it at
`video/assets/music.mp3` (see `video/assets/MUSIC.md`) and credit it wherever you publish.

## Honest notes

- Customers, portals, invoices and amounts are fictional; the portals are modelled on
  *categories* of AP portal, not any vendor's UI. The portal back-ends only know what a real
  buyer's system would know — the agent discovers state by operating the UI.
- The agent is non-deterministic; anything it can't determine comes back `unknown` and is held
  for review, never acted on. The AR posting is a fixed flow — the agent never free-forms into
  the system of record.
- A full agent run is ~40–60 Codex turns (your ChatGPT plan) + five Solari browser sessions +
  one sandbox.
