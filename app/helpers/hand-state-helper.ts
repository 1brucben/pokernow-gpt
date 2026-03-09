import { Table } from "../models/table.ts";

export function hasPostflopState(table: Table): boolean {
  const street = table.getStreet();
  if (street && street !== "preflop") {
    return true;
  }

  if (table.getRunout()) {
    return true;
  }

  return table
    .getHandActionHistory()
    .some((player_action) => player_action.getStreet() !== "preflop");
}

export function shouldResetForStaleBoard(
  table: Table,
  community_cards_state: string | undefined,
): boolean {
  return (
    community_cards_state === "stale-previous-hand" && hasPostflopState(table)
  );
}
