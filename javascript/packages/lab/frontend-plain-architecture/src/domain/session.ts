import { formatMoney, seatsFree } from "../model/lobby";
import type { LiveTable, TableId } from "../model/types";
import type { Store } from "../store/types";

const RECENTLY_PLAYED_LIMIT = 4;

function findTable(store: Store, tableId: TableId): LiveTable | undefined {
  return store.tables.value.find((table) => table.id === tableId);
}

function changeSeatsTaken(store: Store, tableId: TableId, delta: number): void {
  store.tables.value = store.tables.value.map((table) => {
    if (table.id !== tableId) {
      return table;
    }
    return {
      ...table,
      seatsTaken: Math.min(table.seats, Math.max(0, table.seatsTaken + delta)),
    };
  });
}

function selectTable(store: Store, tableId: TableId): void {
  store.selectedTableId.value = tableId;
}

function closeTable(store: Store): void {
  store.selectedTableId.value = null;
}

function toggleFavourite(store: Store, tableId: TableId): void {
  const favourites = store.favouriteIds.value;
  if (favourites.includes(tableId)) {
    store.favouriteIds.value = favourites.filter((id) => id !== tableId);
    return;
  }
  store.favouriteIds.value = [...favourites, tableId];
}

// Takes a seat: frees the previous one first, reserves the minimum bet from the
// balance, and records the table as recently played. Every rejection path ends
// in a notice, so the UI never has to know why a join failed.
function joinTable(store: Store, tableId: TableId): void {
  const table = findTable(store, tableId);
  if (!table) {
    store.notice.value = {
      kind: "error",
      text: "That table is no longer in the lobby",
    };
    return;
  }
  if (table.status === "offline") {
    store.notice.value = {
      kind: "error",
      text: `${table.name} is offline — the studio is not streaming`,
    };
    return;
  }
  if (seatsFree(table) === 0) {
    store.notice.value = {
      kind: "error",
      text: `${table.name} is full — all ${table.seats} seats are taken`,
    };
    return;
  }
  if (store.balance.value < table.minBet) {
    store.notice.value = {
      kind: "error",
      text: `Not enough balance: ${table.name} needs ${formatMoney(table.minBet)} per bet`,
    };
    return;
  }
  if (store.joinedTableId.value !== null && store.joinedTableId.value !== tableId) {
    leaveTable(store);
  }
  changeSeatsTaken(store, tableId, 1);
  store.balance.value = store.balance.value - table.minBet;
  store.joinedTableId.value = tableId;
  store.selectedTableId.value = tableId;
  store.recentlyPlayedIds.value = [
    tableId,
    ...store.recentlyPlayedIds.value.filter((id) => id !== tableId),
  ].slice(0, RECENTLY_PLAYED_LIMIT);
  store.notice.value = {
    kind: "success",
    text: `Seated at ${table.name} — ${formatMoney(table.minBet)} reserved`,
  };
}

// Gives the seat back and refunds the reserved bet.
function leaveTable(store: Store): void {
  const tableId = store.joinedTableId.value;
  if (tableId === null) {
    return;
  }
  const table = findTable(store, tableId);
  changeSeatsTaken(store, tableId, -1);
  store.joinedTableId.value = null;
  if (table) {
    store.balance.value = store.balance.value + table.minBet;
    store.notice.value = {
      kind: "info",
      text: `Left ${table.name} — ${formatMoney(table.minBet)} released`,
    };
  }
}

function topUpBalance(store: Store, amount: number): void {
  store.balance.value = store.balance.value + amount;
  store.notice.value = {
    kind: "success",
    text: `${formatMoney(amount)} added to your balance`,
  };
}

function dismissNotice(store: Store): void {
  store.notice.value = null;
}

export {
  closeTable,
  dismissNotice,
  joinTable,
  leaveTable,
  selectTable,
  toggleFavourite,
  topUpBalance,
};
