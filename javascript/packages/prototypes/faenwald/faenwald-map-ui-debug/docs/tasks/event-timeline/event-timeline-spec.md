# Event Timeline

Context:

- `TGameContext` consist of turns, which are represented in `TGameTurn` interface
- All applied `TGameTurn` events generates a `TGameState`
- There should be a way to create/edit/delete `TGameTurn` events in selected turn and phase

## Feature Decomposition

The goal: see all existing events in the selected turn and phase

Widget which ships the feature - **events timeline**:
![event-timeline-spec-1.png](event-timeline-spec-1.png)

Components tree:

- CurrentTurn
	- CurrentTurn text
	- Button to the next turn (disabled if currently selected turn equals to the current in-game turn)
	- Button to the previous turn (disabled if currently selected turn equals to the first in-game turn)
- EventsTimeline
	- Button to the next phase (disabled if a currently selected phase equals to the current in-game phase of the selected turn or equals to 12 (max in-game phase))
	- Button to the previous phase (disabled if a currently selected phase equals to the first in-game phase of the selected turn)
	- Events timeline
	- Button to add event

Events timeline comp``onent acceptance criteria:

- show all events of the selected turn and phase
- events are placed with gap between them
- events are clickable. On click opens the modal with event details with an option to edit them

