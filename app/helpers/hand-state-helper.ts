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

export function shouldResetForEmptyBoard(
  table: Table,
  community_cards: string[] | undefined,
): boolean {
  return (
    Array.isArray(community_cards) &&
    community_cards.length === 0 &&
    hasPostflopState(table)
  );
}
