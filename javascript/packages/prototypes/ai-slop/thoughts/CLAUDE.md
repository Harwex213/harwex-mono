# thoughts

Mobile-first list of thoughts in three tabs (🎯 goals, 📖 learn, 🌙 dreams). Data lives in `localStorage` under `hw-thoughts/v1`.

- `yarn dev` serves on port 8160 and listens on `0.0.0.0`, so a phone on the same network can open it.
- `src/ui/gestures/list-gestures.ts` handles every row gesture through delegation on the list: tap edits, a horizontal swipe opens the move buttons, a long press lifts the row for reordering. It moves DOM nodes with inline transforms and does not go through React during a gesture.
- A row's text element is filled by hand (`textContent`), not by React children. On tap the element becomes `contenteditable` and gets `focus()` inside `pointerup`, because iOS opens the keyboard only inside a user gesture.
- The drop commits the new order inside `flushSync`, then clears the transforms. Both happen in one frame, so the rows do not flicker.
- The app does not follow `visualViewport`. iOS pans the page to the focused field by itself; moving the app after that pan starts a fight with iOS (flicker, the keyboard closes).
