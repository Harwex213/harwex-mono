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

Events timeline component acceptance criteria:

- show all events of the selected turn and phase
- events are placed with gap between them
- events are clickable. On click opens the modal with event details with an option to edit them

Button to add event acceptance criteria:

- if the selected phase dont have any events, opens the modal to create first event
- if the selected phase has events, highlights empty spaces on the timeline between existing events. After clicking on the highlighted space, opens the modal to create new event

Modal to create/edit event acceptance criteria:

![event-timeline-spec-2.png](event-timeline-spec-2.png)

- first row consist of two selects
	- event type: "system" / "war" (see `TGameTurnPhaseEventType` type)
	- event subtype
		- war (`TGameTurnPhaseWarEventSubtype`)
			- "TWarEvent_ProvincePillaged" | "TWarEvent_Battle" | "TWarEvent_FortressAssault" | "TWarEvent_SiegeStarted" | "TWarEvent_ArmyMoved" | "TWarEvent_ArmyMoveCommand" | "TWarEvent_ArmyCorrection" | "TWarEvent_UnitStartCreating" | "TWarEvent_UnitCreated"
		- system
			- `TSystemEvent_Snapshot`
- form according to the selected event type and subtype
- button to save the event
- button disabled if the form is not valid
	- form is valid if all required fields are filled in creation mode
	- form is valid if all required fields are filled in edit mode
- button disabled if the event has no changes in edit mode

Forms specification according to events:

1) `TSystemEvent_Snapshot`

No form

2) `TDynastyEvent_UpdateHouses`

- house list `THouse`
	- select for an existing house
		- could be null, a new house will be created then
	- input for name
	- input for playerVkId
	- input for authority
	- domain list `string`
		- province button
			- after click, collapse modal to select province (requires integration with MapEngine). After province selection -> expands modal again
	- vassals list
		- select for houseId

3) `TWarEvent_Army`

- province button
	- after click, collapse modal to select province (requires integration with MapEngine). After province selection -> expands modal again
- army select
	- choose one of the currently located in the province
	- could be null, new army will be created then
- units list `TArmyUnit`
	- select for kind
	- select for type
	- input for amount
	- input for stripes
	- select for rank
	- modifiers list
	- house select
	- notion: `baseHp`, `baseAttack`, `baseMorale`, `baseSpeed`, `baseCost`
