# Event Timeline — Implementation Plan

## Overview

A horizontal widget at the bottom of the map UI that displays all events for the currently selected turn and phase, with navigation controls for browsing turns/phases.

## Current State

- `MapEngine` already stores `turn` and `phase` in its internal state (as strings, from localStorage)
- `MapEngine` already loads `TGameContext` via `loadGameContext()` and computes `TGameState` via `createGameState()`
- `DebugPanel` has basic turn/phase text inputs — these will be superseded by the new widget's navigation buttons
- Turn/phase changes trigger full `loadAssets()` (reloads images + game context) — this is wasteful since only game state needs recomputing, but out of scope for now

## Data Flow

```
MapEngine.gameContext.turns[selectedTurn].phases[selectedPhase] → TGameTurnPhaseEvent[]
```

The widget needs read access to:
- `gameContext.turns` — to know min/max turn bounds
- `gameContext.gameState.currentTurn` / `currentPhase` — to know the "live" turn/phase (for disabling "next" buttons)
- The events array for the selected turn+phase

## Implementation Steps

### Step 1: Expose game context from MapEngine

Add public getters to `MapEngine`:

- `get gameContextData(): TGameContext | null` — expose game context for the UI
- `get currentTurn(): number` — parsed numeric turn
- `get currentPhase(): number` — parsed numeric phase

This lets React components read turn/phase/events without duplicating state.

### Step 2: Create `EventTimeline` component

**File:** `src/ui/event-timeline/event-timeline.tsx`
**CSS:** `src/ui/event-timeline/event-timeline.module.css`

Component tree (matching the spec wireframe):

```
<EventTimeline mapEngine={MapEngine}>
  <CurrentTurn>
    <button> ← prev turn </button>
    <span> current turn </span>
    <button> next turn → </button>
  </CurrentTurn>
  <PhaseAndEvents>
    <button> ← prev phase </button>
    <EventsList>
      {events.map(event => <EventCard event={event} onClick={openModal} />)}
    </EventsList>
    <button> next phase → </button>
    <button> + add event </button>
  </PhaseAndEvents>
</EventTimeline>
```

### Step 3: `CurrentTurn` sub-component

Inline within the same file (or extracted if it grows).

**Props:** `turn: number`, `minTurn: number`, `maxTurn: number`, `onChangeTurn: (turn: number) => void`

- Displays "Turn {n}"
- Prev button: disabled when `turn === minTurn` (first turn index, typically 0)
- Next button: disabled when `turn === maxTurn` (equals `gameContext.gameState.currentTurn`)

### Step 4: Phase navigation + events list

**Phase navigation:**
- Prev phase: disabled when `selectedPhase === 0` (first phase of the turn)
- Next phase: disabled when `selectedPhase === currentPhase` (for the current turn) OR `selectedPhase === 11` (max 12 phases, 0-indexed)
- For past turns (not the current turn), allow navigating all 12 phases freely

**Events list:**
- Horizontal scrollable row of event cards
- Each card shows the event type as a label (e.g. "Battle", "Army Moved", "Pillaged")
- Cards are clickable — on click, open a modal (placeholder for now, modal editing is a separate feature per spec)
- Gap between cards

**Add event button:**
- Rightmost element in the row
- Placeholder action for now (the spec mentions "start creating new event" but details are in a separate feature)

### Step 5: `EventCard` sub-component

Displays a single `TGameTurnPhaseEvent`:
- For `type: "system"` — show "System" label
- For `type: "war"` — show the inner event type translated:
  - `TWarEvent_Battle` → "Battle"
  - `TWarEvent_ArmyMoved` → "Move"
  - `TWarEvent_ArmyMoveCommand` → "Move Cmd"
  - `TWarEvent_ProvincePillaged` → "Pillage"
  - `TWarEvent_ArmyCorrection` → "Correction"
  - `TWarEvent_UnitStartCreating` → "Recruit"
  - `TWarEvent_UnitCreated` → "Unit Ready"
  - `TWarEvent_SiegeStarted` → "Siege"
  - `TWarEvent_FortressAssault` → "Assault"

### Step 6: Wire into `App.tsx`

- Render `<EventTimeline mapEngine={_mapEngine} />` alongside the existing overlays
- Position it at the bottom of the viewport (absolute, full width)
- Keep `DebugPanel` as-is (it has other debug features like province centers toggle and province list)

### Step 7: Styling

Follow existing conventions:
- CSS Modules with camelCaseOnly
- Dark theme: black/dark background, white text, gold accents (matching debug-panel)
- Semi-transparent backdrop matching existing overlays (`rgba(0,0,0,0.72)`, `backdrop-filter: blur(4px)`)
- Horizontal layout for the events row, vertical stack for turn label above phase+events
- Fixed to bottom of viewport

## File Changes Summary

| File | Action |
|------|--------|
| `src/core/map-engine/map-engine.ts` | Add public getters for gameContext, turn, phase |
| `src/ui/event-timeline/event-timeline.tsx` | New — main widget component |
| `src/ui/event-timeline/event-timeline.module.css` | New — widget styles |
| `src/ui/App.tsx` | Import and render `EventTimeline` |

## Out of Scope

- Event editing modal (clicking an event opens modal — deferred to separate task)
- Add event flow (button will be present but non-functional)
- Optimizing turn/phase changes to avoid full asset reload
- Removing turn/phase inputs from DebugPanel (keep for now as alternative control)