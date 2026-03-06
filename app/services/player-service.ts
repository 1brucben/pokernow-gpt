import { DBService } from "./db-service.ts";
import { emptyOrSingleRow } from "../helpers/db-query-helper.ts";

export class PlayerService {
  private db_service: DBService;

  constructor(db_service: DBService) {
    this.db_service = db_service;
  }

  async get(player_name: string): Promise<string> {
    const rows = await this.db_service.query(
      `SELECT *
             FROM PlayerStats
             WHERE name = ?`,
      [player_name],
    );
    return emptyOrSingleRow(rows);
  }

  async create(player_stats_JSON: any): Promise<void> {
    await this.db_service.query(
      `INSERT INTO PlayerStats
             (name, total_hands, walks, vpip_hands, pfr_hands,
              postflop_bets_raises, postflop_calls, cbet_opportunities, cbet_made,
              faced_cbet, folded_to_cbet, saw_flop, went_to_showdown,
              three_bet_opportunities, three_bet_made, faced_three_bet, folded_to_three_bet,
              postflop_checks,
              second_barrel_opportunities, second_barrel_made,
              third_barrel_opportunities, third_barrel_made,
              faced_second_barrel, folded_to_second_barrel,
              faced_third_barrel, folded_to_third_barrel,
              donk_bet_opportunities, donk_bet_made,
              check_raise_opportunities, check_raise_made)
             VALUES
             (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        player_stats_JSON.name,
        player_stats_JSON.total_hands,
        player_stats_JSON.walks,
        player_stats_JSON.vpip_hands,
        player_stats_JSON.pfr_hands,
        player_stats_JSON.postflop_bets_raises ?? 0,
        player_stats_JSON.postflop_calls ?? 0,
        player_stats_JSON.cbet_opportunities ?? 0,
        player_stats_JSON.cbet_made ?? 0,
        player_stats_JSON.faced_cbet ?? 0,
        player_stats_JSON.folded_to_cbet ?? 0,
        player_stats_JSON.saw_flop ?? 0,
        player_stats_JSON.went_to_showdown ?? 0,
        player_stats_JSON.three_bet_opportunities ?? 0,
        player_stats_JSON.three_bet_made ?? 0,
        player_stats_JSON.faced_three_bet ?? 0,
        player_stats_JSON.folded_to_three_bet ?? 0,
        player_stats_JSON.postflop_checks ?? 0,
        player_stats_JSON.second_barrel_opportunities ?? 0,
        player_stats_JSON.second_barrel_made ?? 0,
        player_stats_JSON.third_barrel_opportunities ?? 0,
        player_stats_JSON.third_barrel_made ?? 0,
        player_stats_JSON.faced_second_barrel ?? 0,
        player_stats_JSON.folded_to_second_barrel ?? 0,
        player_stats_JSON.faced_third_barrel ?? 0,
        player_stats_JSON.folded_to_third_barrel ?? 0,
        player_stats_JSON.donk_bet_opportunities ?? 0,
        player_stats_JSON.donk_bet_made ?? 0,
        player_stats_JSON.check_raise_opportunities ?? 0,
        player_stats_JSON.check_raise_made ?? 0,
      ],
    );
  }

  async update(player_name: string, player_stats_JSON: any): Promise<void> {
    await this.db_service.query(
      `UPDATE PlayerStats
             SET 
                total_hands = ?,
                walks = ?,
                vpip_hands = ?,
                pfr_hands = ?,
                postflop_bets_raises = ?,
                postflop_calls = ?,
                cbet_opportunities = ?,
                cbet_made = ?,
                faced_cbet = ?,
                folded_to_cbet = ?,
                saw_flop = ?,
                went_to_showdown = ?,
                three_bet_opportunities = ?,
                three_bet_made = ?,
                faced_three_bet = ?,
                folded_to_three_bet = ?,
                postflop_checks = ?,
                second_barrel_opportunities = ?,
                second_barrel_made = ?,
                third_barrel_opportunities = ?,
                third_barrel_made = ?,
                faced_second_barrel = ?,
                folded_to_second_barrel = ?,
                faced_third_barrel = ?,
                folded_to_third_barrel = ?,
                donk_bet_opportunities = ?,
                donk_bet_made = ?,
                check_raise_opportunities = ?,
                check_raise_made = ?
             WHERE name = ?`,
      [
        player_stats_JSON.total_hands,
        player_stats_JSON.walks,
        player_stats_JSON.vpip_hands,
        player_stats_JSON.pfr_hands,
        player_stats_JSON.postflop_bets_raises ?? 0,
        player_stats_JSON.postflop_calls ?? 0,
        player_stats_JSON.cbet_opportunities ?? 0,
        player_stats_JSON.cbet_made ?? 0,
        player_stats_JSON.faced_cbet ?? 0,
        player_stats_JSON.folded_to_cbet ?? 0,
        player_stats_JSON.saw_flop ?? 0,
        player_stats_JSON.went_to_showdown ?? 0,
        player_stats_JSON.three_bet_opportunities ?? 0,
        player_stats_JSON.three_bet_made ?? 0,
        player_stats_JSON.faced_three_bet ?? 0,
        player_stats_JSON.folded_to_three_bet ?? 0,
        player_stats_JSON.postflop_checks ?? 0,
        player_stats_JSON.second_barrel_opportunities ?? 0,
        player_stats_JSON.second_barrel_made ?? 0,
        player_stats_JSON.third_barrel_opportunities ?? 0,
        player_stats_JSON.third_barrel_made ?? 0,
        player_stats_JSON.faced_second_barrel ?? 0,
        player_stats_JSON.folded_to_second_barrel ?? 0,
        player_stats_JSON.faced_third_barrel ?? 0,
        player_stats_JSON.folded_to_third_barrel ?? 0,
        player_stats_JSON.donk_bet_opportunities ?? 0,
        player_stats_JSON.donk_bet_made ?? 0,
        player_stats_JSON.check_raise_opportunities ?? 0,
        player_stats_JSON.check_raise_made ?? 0,
        player_name,
      ],
    );
  }

  async remove(player_name: string): Promise<void> {
    await this.db_service.query(
      `DELETE FROM PlayerStats
             WHERE name = ?`,
      [player_name],
    );
  }
}
