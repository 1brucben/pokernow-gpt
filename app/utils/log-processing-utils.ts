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

  // Barrel tracking (2nd barrel = turn cbet, 3rd barrel = river cbet)
  let pfa_acted_on_turn = false;
  let turn_bet_before_pfa = false;
  let second_barrel_happened = false;
  let pfa_acted_on_river = false;
  let river_bet_before_pfa = false;
  let third_barrel_happened = false;

  // Track whether the c-bet / barrel was raised (disables subsequent barrel tracking)
  let flop_cbet_was_raised = false;
  let turn_barrel_was_raised = false;

  // Players who called the flop c-bet / turn barrel (for fold-to-barrel tracking)
  const callers_of_flop_cbet = new Set<string>();
  const callers_of_turn_barrel = new Set<string>();

  // Donk bet tracking per street (non-PFA bets into PFA before PFA acts)
  // (flop donk bet is already partially detected via flop_bet_before_pfa)

  // Check-raise tracking: per-street, who checked and then might raise
  const checked_this_street = new Set<string>();
  let bet_happened_this_street = false;

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
      // Reset per-street check-raise tracking
      checked_this_street.clear();
      bet_happened_this_street = false;
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

        // --- Check-raise tracking (any post-flop street) ---
        if (action === Action.CHECK) {
          checked_this_street.add(player_id);
        }
        if (action === Action.BET || action === Action.RAISE) {
          bet_happened_this_street = true;
        }
        // If player previously checked this street and now raises → check-raise
        if (action === Action.RAISE && checked_this_street.has(player_id)) {
          table.setHandCheckRaiseOpportunity(player_id, true);
          table.setHandCheckRaiseMade(player_id, true);
        }
        // A player who checks and then a bet happens has a check-raise opportunity
        // (they'll get a chance to raise if action comes back)
        // We track the opportunity when they actually face a bet after checking
        if (
          bet_happened_this_street &&
          checked_this_street.has(player_id) &&
          (action === Action.CALL || action === Action.FOLD) &&
          !table.getHandCheckRaiseOpportunityValue(player_id)
        ) {
          table.setHandCheckRaiseOpportunity(player_id, true);
        }

        // --- C-bet tracking (flop only) ---
        if (current_street === "flop" && preflop_aggressor) {
          // Track if someone bet/raised before the PFA acts (donk-bet)
          if (!pfa_acted_on_flop && player_id !== preflop_aggressor) {
            // Only the first bet into PFA counts as a donk bet opportunity
            if (!flop_bet_before_pfa) {
              if (action === Action.BET || action === Action.RAISE) {
                flop_bet_before_pfa = true;
                // This is a donk bet
                table.setHandDonkBetOpportunity(player_id, true);
                table.setHandDonkBetMade(player_id, true);
              } else if (action === Action.CHECK) {
                // Player checked, they had a donk bet opportunity but didn't take it
                table.setHandDonkBetOpportunity(player_id, true);
              }
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
            } else if (action === Action.CALL) {
              callers_of_flop_cbet.add(player_id);
            } else if (action === Action.RAISE) {
              // C-bet was raised — PFA lost initiative, no further barrels
              flop_cbet_was_raised = true;
            }
          }
        }

        // --- 2nd Barrel tracking (turn) ---
        // Only track if PFA c-bet the flop AND the c-bet was not raised
        if (
          current_street === "turn" &&
          preflop_aggressor &&
          cbet_happened &&
          !flop_cbet_was_raised
        ) {
          // Track if someone bets before PFA on the turn (donk bet on turn)
          if (!pfa_acted_on_turn && player_id !== preflop_aggressor) {
            if (action === Action.BET || action === Action.RAISE) {
              turn_bet_before_pfa = true;
            }
          }

          // PFA's first action on the turn
          if (player_id === preflop_aggressor && !pfa_acted_on_turn) {
            pfa_acted_on_turn = true;
            if (!turn_bet_before_pfa) {
              table.setHandSecondBarrelOpportunity(player_id, true);
              if (action === Action.BET || action === Action.RAISE) {
                second_barrel_happened = true;
                table.setHandSecondBarrelMade(player_id, true);
              }
            }
          }

          // Track players facing the 2nd barrel
          if (second_barrel_happened && player_id !== preflop_aggressor) {
            // Only players who called the flop c-bet can face/fold to 2nd barrel
            if (callers_of_flop_cbet.has(player_id)) {
              table.setHandFacedSecondBarrel(player_id, true);
              if (action === Action.FOLD) {
                table.setHandFoldedToSecondBarrel(player_id, true);
              } else if (action === Action.CALL) {
                callers_of_turn_barrel.add(player_id);
              } else if (action === Action.RAISE) {
                // Turn barrel was raised — no 3rd barrel
                turn_barrel_was_raised = true;
              }
            }
          }
        }

        // --- 3rd Barrel tracking (river) ---
        // Only track if PFA 2nd-barreled AND the turn barrel was not raised
        if (
          current_street === "river" &&
          preflop_aggressor &&
          second_barrel_happened &&
          !turn_barrel_was_raised
        ) {
          // Track if someone bets before PFA on the river
          if (!pfa_acted_on_river && player_id !== preflop_aggressor) {
            if (action === Action.BET || action === Action.RAISE) {
              river_bet_before_pfa = true;
            }
          }

          // PFA's first action on the river
          if (player_id === preflop_aggressor && !pfa_acted_on_river) {
            pfa_acted_on_river = true;
            if (!river_bet_before_pfa) {
              table.setHandThirdBarrelOpportunity(player_id, true);
              if (action === Action.BET || action === Action.RAISE) {
                third_barrel_happened = true;
                table.setHandThirdBarrelMade(player_id, true);
              }
            }
          }

          // Track players facing the 3rd barrel
          if (third_barrel_happened && player_id !== preflop_aggressor) {
            if (callers_of_turn_barrel.has(player_id)) {
              table.setHandFacedThirdBarrel(player_id, true);
              if (action === Action.FOLD) {
                table.setHandFoldedToThirdBarrel(player_id, true);
              }
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
