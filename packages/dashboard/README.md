# AgentGuard Dashboard

React 18 + Vite + Tailwind dashboard for **AgentGuard**, the multi-agent security
orchestrator. Live agent feed, audit chain visualization, policy viewer, and
real-time violation browser — all wired to the sidecar over HTTP + WebSocket.

> Pure browser code. The dashboard never imports from `@agentguard/core` or
> `@agentguard/sidecar`; it talks to the sidecar exclusively over its public
> HTTP/WebSocket API. This keeps the bundle safe to ship to any static host.

## Quick start

```bash
# from repo root
npm install                  # workspaces pick this up automatically
npm run dev:dashboard        # http://localhost:5173
```

The dashboard expects the sidecar to be running on the URL set in
`VITE_SIDECAR_URL` (default `/api` — Vite will proxy `localhost:9559` in dev).
You can also start it via `npm run dev` to run the sidecar + dashboard
together once the sidecar package is in place.

## Scripts

| script | purpose |
| ------ | ------- |
| `npm run dev` | Vite dev server with HMR (port 5173) |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Serve the built bundle (port 4173) |
| `npm run typecheck` | `tsc -b --noEmit` |

## Environment variables

The dashboard reads two variables at build/dev time:

| variable | default | purpose |
| -------- | ------- | ------- |
| `VITE_SIDECAR_URL` | `/api` | Base URL for the sidecar REST API. Set to e.g. `http://localhost:9559` if not using a Vite proxy. |
| `VITE_WS_URL` | `ws://localhost:9559/stream` | WebSocket endpoint for live event invalidations. |

If the sidecar is unreachable, the dashboard renders with mock data and
shows a banner — your local dev experience never breaks because the
sidecar is down.

## Architecture

```
src/
├── main.tsx                 # root, providers, stream connect
├── App.tsx                  # router + layout shell
├── styles.css               # tailwind + tokens + animations
├── design-system/
│   ├── tokens.css           # CSS variables (light + dark via prefers-color-scheme)
│   ├── animations.css       # volcano-pulse, shimmer, agent-think, agent-shake, page-enter, modal-enter
│   └── index.ts             # runtime exports of tokens (TS consumers)
├── lib/
│   ├── api.ts               # sidecar HTTP client + mock fallback
│   ├── ws.ts                # WS client + reconnect + TanStack invalidation
│   ├── store.ts             # Zustand: selectedAgent, audit filters
│   ├── format.ts            # date / CSV / class helpers
│   └── types.ts             # domain types (Decision, AuditEntry, PolicySet, …)
├── components/
│   ├── ui/                  # Button, Card, Badge, Skeleton, Modal, Toast,
│   │                        # AgentStatusDot, PolicyEvaluator, SmartPagination, Logo
│   ├── layout/              # Sidebar, Header (sidecar/WS status badges)
│   ├── dashboard/           # KPICard, LiveFeed, AuditChainView, ViolationRow,
│   │                        # PolicyViewer, AgentStatusCard, AuditLogViewer
│   └── ErrorBoundary.tsx    # top-level + AsyncBoundary
└── pages/                   # Home, Agents, Policies, Audit (real),
                             # Alerts, Settings (placeholders)
```

### State

* **Server state** — TanStack Query (`@tanstack/react-query`) powers
  `getHealth`, `getRecentAudit`, `getKpis`, `getPolicies`, `verifyAudit`,
  `reloadPolicies`. The WebSocket client dispatches `invalidateQueries`
  on `audit | agent | policy | heartbeat` frames.
* **Client state** — Zustand holds the *selected agent* and the *audit
  filters* (severity, decision, search).

### Design tokens

All colors are CSS variables (see `src/design-system/tokens.css`). Dark
mode is automatic via `prefers-color-scheme`. Tailwind reads the same
variables in `tailwind.config.js`, so `bg-primary`, `text-error`,
`border-border` etc. always resolve to the current theme.

Animations honor `prefers-reduced-motion: reduce` (all keyframes/utility
classes are disabled by the global media query in
`src/design-system/animations.css`).

## Connecting to a real sidecar

The dashboard assumes the sidecar exposes these endpoints:

| method | path | purpose |
| ------ | ---- | ------- |
| GET    | `/health` | uptime, version, policies/audit counts |
| GET    | `/audit/recent?limit=N` | last N entries (newest first) |
| GET    | `/audit/by-agent/:id?since=ISO` | entries for one agent |
| POST   | `/audit/verify` | full chain integrity check |
| GET    | `/policies` | current policy set (rules + source YAML) |
| POST   | `/policies/reload` | hot-reload from disk |
| GET    | `/agents` | live agent roster with states |
| GET    | `/kpis` | aggregated allowed/blocked/latency/integrity |
| WS     | `/stream` | event stream: `{ type: "audit" \| "agent" \| "policy" \| "heartbeat", payload }` |

If any endpoint returns 4xx/5xx or the request times out, the dashboard
falls back to the bundled mock data so it remains usable.

## Build artifacts

```bash
npm run build
```

Produces `dist/index.html` + chunked JS/CSS. The dashboard targets
`es2022`; older browsers will need additional polyfills.