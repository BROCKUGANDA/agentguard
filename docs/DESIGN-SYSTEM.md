# AgentGuard Design System

## Philosophy

**Transparent Security** — every interaction communicates:

- **Clarity** — users always know what's happening (no mystery states)
- **Control** — users can override, pause, or audit any agent action
- **Trust** — visual cues reinforce security (locks, shields, audit trails)
- **Speed** — animations feel snappy (<300ms), not sluggish

## Tokens

### Typography

```css
--font-sans:    'Inter', system-ui, sans-serif;
--font-mono:    'JetBrains Mono', 'Cascadia Code', monospace;
--font-display: 'Space Grotesk', 'Inter', sans-serif;
```

| Token | Size | Weight | Use |
|---|---|---|---|
| text-xs | 12px | 400 | metadata, timestamps |
| text-sm | 14px | 400/500 | body, labels |
| text-base | 16px | 400/500 | default body |
| text-lg | 18px | 500/600 | subheadings |
| text-xl | 20px | 600 | card titles |
| text-2xl | 24px | 600/700 | section headers |
| text-3xl | 30px | 700 | KPIs |
| text-4xl | 36px | 700 | hero / logo lockup |

### Colors

```css
/* Primary */
--color-primary:        #E63946;  /* Volcano Red */
--color-primary-hover:  #D62828;
--color-primary-light:  #FF6B6B;

/* Secondary */
--color-secondary:        #457B9D;
--color-secondary-hover:  #3A6B8C;

/* Status */
--color-success: #2A9D8F;   /* emerald */
--color-warning: #F4A261;   /* amber  */
--color-error:   #D62828;   /* crimson */
--color-info:    #457B9D;

/* Neutrals */
--color-bg:        #F8F9FA;
--color-surface:   #FFFFFF;
--color-border:    #E5E7EB;
--color-text:      #2B2D42;
--color-text-muted:#6B7280;

/* Security-specific */
--color-secure:   #2A9D8F;  /* allowed */
--color-blocked:  #D62828;  /* denied   */
--color-pending:  #F4A261;  /* evaluating */
```

### Spacing / Radius / Shadow

```css
--space-xs: 4px; --space-sm: 8px; --space-md: 16px;
--space-lg: 24px; --space-xl: 32px; --space-2xl: 48px;

--radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-full: 9999px;

--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px rgba(0,0,0,0.1);
--shadow-lg: 0 10px 15px rgba(0,0,0,0.1);
--shadow-xl: 0 20px 25px rgba(0,0,0,0.15);
```

## Dark mode

Auto via `prefers-color-scheme: dark`:

```css
@media (prefers-color-scheme: dark) {
  --color-bg:      #0F172A;
  --color-surface: #1E293B;
  --color-border:  #334155;
  --color-text:    #F1F5F9;
  --color-text-muted: #94A3B8;
}
```

## Animations

| Name | Duration | Use |
|---|---|---|
| `volcano-pulse` | 1.5s ∞ | splash loader, AgentThinking |
| `shimmer` | 1.2s ∞ | skeleton placeholders |
| `agent-think` | 1.5s ∞ | status dot thinking |
| `agent-act` | 0.8s ∞ | status dot acting |
| `agent-shake` | 0.3s | status dot blocked |
| `page-enter` | 300ms ease-out | route transitions |
| `modal-enter` | 250ms ease-out | modals |

All animations respect `@media (prefers-reduced-motion: reduce)`.

## Components

### UI primitives

- `Button` — primary | secondary | danger | ghost · sm | md | lg
- `Card` — base container
- `Badge` — status pill (allowed / blocked / pending / info)
- `Skeleton` — shimmer line / block / circle
- `Modal` — backdrop-blur, scale-in
- `Toast` — top slide-in, auto-dismiss
- `AgentStatusDot` — idle / thinking / acting / blocked
- `PolicyEvaluator` — circular progress with policy name
- `SmartPagination` — adaptive collapse + jump-to
- `Logo` — SVG shield + volcano

### Dashboard components

- `KPICard` — large number + trend
- `LiveFeed` — WebSocket-powered activity stream
- `AuditLogViewer` — infinite scroll + filter + CSV export
- `AuditChainView` — visualizes prev_hash links
- `AgentStatusCard` — agent name + status + last action
- `PolicyViolationRow` — timestamp + agent + policy + decision
- `PolicyViewer` — YAML viewer with reload

## Motion principles

- **Purposeful** — every animation serves a function (feedback, orientation, delight)
- **Fast** — default 200-300ms, never >500ms unless complex
- **Eased** — `cubic-bezier(0.4, 0, 0.2, 1)` for natural feel
- **Reduced** — kill all animations under `prefers-reduced-motion: reduce`

## Performance budget

- First Contentful Paint: <1.5s
- Time to Interactive: <3s
- Animation FPS: 60fps (no jank)
- Bundle size: <200KB gzipped