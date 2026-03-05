import { Game } from "../models/game.ts";
import { PlayerAction } from "../models/player-action.ts";
import { Queue } from "./data-structures.ts";
import { convertToBBs } from "./value-conversion-utils.ts";

export enum Action {
  BET = "bets",
  CALL = "calls",
  FOLD = "folds",
  RAISE = "raises",
  POST = "posts",
  CHECK = "checks",
}

export enum Street {
  PREFLOP = "Preflop",
  FLOP = "Flop",
  TURN = "Turn",
  RIVER = "River",
}

export const suitToLetter: Map<string, string> = new Map<string, string>([
  ["♠", "s"],
  ["♥", "h"],
  ["♦", "d"],
  ["♣", "c"],
]);

export function preProcessLogs(logs: Array<Array<string>>, game: Game) {
  const table = game.getTable();
  logs = logs.reverse();
  logs.forEach((element) => {
    if (
      element[2] === "posts" &&
      element[4] === game.getSmallBlind().toString()
    ) {
      table.setFirstSeatOrderId(element[0]);
    }
    table.updateLogsQueue(element);
  });
}

export async function postProcessLogs(
  logs_queue: Queue<Array<string>>,
  game: Game,
) {
  const table = game.getTable();
  while (!logs_queue.isEmpty()) {
    const log = logs_queue.dequeue();
    //process player action
    if (log != null) {
      if (!Object.values<string>(Street).includes(log[0])) {
        const player_id = log[0];
        const action = log[2];
        const bet_size = log[4];
        if (action === "folds") {
          table.decrementPlayersInPot();
        }
        let player_action = new PlayerAction(
          player_id,
          action,
          convertToBBs(Number(bet_size), game.getBigBlind()),
        );
        table.updatePlayerActions(player_action);
      } else {
        const street = log[0];
        const runout = log[1];
        table.setStreet(street.toLowerCase());
        table.setRunout(
          Array.from(suitToLetter.entries()).reduce(
            (prev, entry) => prev.replaceAll(...entry),
            runout,
          ),
        );
      }
    }
  }
}

export async function postProcessLogsAfterHand(
  logs: Array<Array<string>>,
  game: Game,
) {
  const table = game.getTable();

  // --- Preflop tracking (existing logic) ---
  // 0 means they didn't put in money, 1 means they put in money but didn't raise (CALL)
  // 2 means they put in money through a raise. 1 -> vpip, 2 -> vpip & pfr
  // higher numbers override lower numbers
  let action_count = 0;
  let current_street = "preflop";
  let preflop_aggressor: string | null = null;
  const players_in_hand = new Set<string>();
  const players_who_saw_flop = new Set<string>();
  let flop_reached = false;

  // Per-player postflop counters for this hand
  const hand_postflop_bets_raises = new Map<string, number>();
  const hand_postflop_calls = new Map<string, number>();
  const hand_postflop_checks = new Map<string, number>();

  // C-bet tracking for this hand
  let pfa_acted_on_flop = false;
  let flop_bet_before_pfa = false; // true if someone donk-bets before PFA acts
  let cbet_happened = false;

  // 3-Bet tracking: count preflop raise actions to detect 3-bets
  let preflop_raise_count = 0;
  let first_raiser: string | null = null; // the open-raiser (for fold-to-3-bet tracking)

  // Track players who folded postflop (to compute WTSD)
  const folded_postflop = new Set<string>();

  // Track all players still in at hand end (for showdown detection)
  const players_remaining = new Set<string>();

  for (const log of logs) {
    // Street change detection
    if (log.length === 2 && Object.values<string>(Street).includes(log[0])) {
      const street_name = log[0];
      if (street_name === Street.FLOP && current_street === "preflop") {
        flop_reached = true;
        // Players still in hand at this point saw the flop
        for (const pid of players_in_hand) {
          players_who_saw_flop.add(pid);
          players_remaining.add(pid);
        }
      }
      current_street = street_name.toLowerCase();
      continue;
    }

    // Action log: [player_id, player_name, action_word, full_msg, bet_amount]
    if (log.length > 3) {
      const player_id = log[0];
      const action = log[2];

      if (current_street === "preflop") {
        // Existing preflop action tracking
        let action_num = 0;
        if (action === Action.CALL) {
          action_num = 1;
          action_count += 1;
        } else if (action === Action.BET || action === Action.RAISE) {
          action_num = 2;
          action_count += 1;
          preflop_raise_count += 1;

          if (preflop_raise_count === 1) {
            // This is the open-raise
            first_raiser = player_id;
          } else if (preflop_raise_count === 2) {
            // This is the 3-bet
            // The 3-bettor had a 3-bet opportunity and took it
            table.setHandThreeBetOpportunity(player_id, true);
            table.setHandThreeBetMade(player_id, true);
            // The original raiser now faces a 3-bet
            if (first_raiser) {
              table.setHandFacedThreeBet(first_raiser, true);
            }
          }

          preflop_aggressor = player_id;
        }

        // 3-bet opportunity: any player who acts after the open-raise and before the 3-bet
        // has the opportunity to 3-bet (if they call or fold instead, they had the chance)
        if (preflop_raise_count === 1 && player_id !== first_raiser) {
          // This player had a chance to 3-bet
          table.setHandThreeBetOpportunity(player_id, true);
        }

        // Track fold-to-3-bet: if the original raiser folds after the 3-bet
        if (
          preflop_raise_count >= 2 &&
          player_id === first_raiser &&
          action === Action.FOLD
        ) {
          table.setHandFoldedToThreeBet(first_raiser, true);
        }

        if (
          !table.existsInIdToActionNum(player_id) ||
          table.getActionNumFromId(player_id)! < action_num
        ) {
          table.updateIdToActionNum(player_id, action_num);
        }

        // Track who is in the hand
        if (action === Action.FOLD) {
          players_in_hand.delete(player_id);
        } else {
          players_in_hand.add(player_id);
        }
      } else {
        // --- Post-flop action tracking ---

        // Aggression tracking
        if (action === Action.BET || action === Action.RAISE) {
          hand_postflop_bets_raises.set(
            player_id,
            (hand_postflop_bets_raises.get(player_id) ?? 0) + 1,
          );
        } else if (action === Action.CALL) {
          hand_postflop_calls.set(
            player_id,
            (hand_postflop_calls.get(player_id) ?? 0) + 1,
          );
        } else if (action === Action.CHECK) {
          hand_postflop_checks.set(
            player_id,
            (hand_postflop_checks.get(player_id) ?? 0) + 1,
          );
        }

        // C-bet tracking (flop only)
        if (current_street === "flop" && preflop_aggressor) {
          // Track if someone bet/raised before the PFA acts (donk-bet)
          if (!pfa_acted_on_flop && player_id !== preflop_aggressor) {
            if (action === Action.BET || action === Action.RAISE) {
              flop_bet_before_pfa = true;
            }
          }

          // PFA's first action on the flop
          if (player_id === preflop_aggressor && !pfa_acted_on_flop) {
            pfa_acted_on_flop = true;
            // Only a c-bet opportunity if nobody donk-bet before the PFA
            if (!flop_bet_before_pfa) {
              table.setHandCbetOpportunity(player_id, true);
              if (action === Action.BET || action === Action.RAISE) {
                cbet_happened = true;
                table.setHandCbetMade(player_id, true);
              }
            }
          }

          // Track players facing the c-bet
          if (cbet_happened && player_id !== preflop_aggressor) {
            table.setHandFacedCbet(player_id, true);
            if (action === Action.FOLD) {
              table.setHandFoldedToCbet(player_id, true);
            }
          }
        }

        // Track postflop folds for WTSD & remaining count
        if (action === Action.FOLD) {
          folded_postflop.add(player_id);
          players_remaining.delete(player_id);
        }
      }
    }
  }

  // Handle walks (no voluntary actions preflop)
  if (action_count == 0) {
    const player_ids_arr = Array.from(table.getIdToActionNum().keys());
    player_ids_arr.forEach((player_id) => {
      const player_stats = table.getPlayerStatsFromName(
        table.getNameFromId(player_id),
      );
      player_stats.incrementWalks();
    });
  }

  // Store per-player postflop data on the table for processPlayers to use
  for (const [pid, count] of hand_postflop_bets_raises) {
    table.setHandPostflopBetsRaises(pid, count);
  }
  for (const [pid, count] of hand_postflop_calls) {
    table.setHandPostflopCalls(pid, count);
  }
  for (const [pid, count] of hand_postflop_checks) {
    table.setHandPostflopChecks(pid, count);
  }

  // Showdown = 2+ players remain at hand end after the flop was reached
  const showdown_occurred = flop_reached && players_remaining.size >= 2;

  // Mark saw_flop and WTSD
  for (const pid of players_who_saw_flop) {
    table.setHandSawFlop(pid, true);
    // WTSD: player saw the flop, didn't fold, AND the hand actually went to showdown
    if (showdown_occurred && !folded_postflop.has(pid)) {
      table.setHandWentToShowdown(pid, true);
    }
  }
}
