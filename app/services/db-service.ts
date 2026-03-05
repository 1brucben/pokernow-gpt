import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";

export class DBService {
  private file_name: string;
  private db!: BetterSqlite3.Database;

  constructor(file_name: string) {
    this.file_name = file_name;
  }

  async init(): Promise<void> {
    this.db = new Database(this.file_name);
  }

  async createTables(): Promise<void> {
    await this.createPlayerTable();
  }

  async createPlayerTable(): Promise<void> {
    try {
      this.db.exec(`
                CREATE TABLE IF NOT EXISTS PlayerStats (
                    name TEXT PRIMARY KEY NOT NULL,
                    total_hands INT NOT NULL,
                    walks INT NOT NULL,
                    vpip_hands INT NOT NULL,
                    vpip_stat REAL AS (vpip_hands / CAST((total_hands - walks) AS REAL)),
                    pfr_hands INT NOT NULL,
                    pfr_stat REAL AS (pfr_hands / CAST((total_hands - walks) AS REAL)),
                    postflop_bets_raises INT NOT NULL DEFAULT 0,
                    postflop_calls INT NOT NULL DEFAULT 0,
                    cbet_opportunities INT NOT NULL DEFAULT 0,
                    cbet_made INT NOT NULL DEFAULT 0,
                    faced_cbet INT NOT NULL DEFAULT 0,
                    folded_to_cbet INT NOT NULL DEFAULT 0,
                    saw_flop INT NOT NULL DEFAULT 0,
                    went_to_showdown INT NOT NULL DEFAULT 0,
                    three_bet_opportunities INT NOT NULL DEFAULT 0,
                    three_bet_made INT NOT NULL DEFAULT 0,
                    faced_three_bet INT NOT NULL DEFAULT 0,
                    folded_to_three_bet INT NOT NULL DEFAULT 0,
                    postflop_checks INT NOT NULL DEFAULT 0
                );
            `);
      // Add new columns to existing tables (safe to run repeatedly)
      const newColumns = [
        { name: "postflop_bets_raises", type: "INT NOT NULL DEFAULT 0" },
        { name: "postflop_calls", type: "INT NOT NULL DEFAULT 0" },
        { name: "cbet_opportunities", type: "INT NOT NULL DEFAULT 0" },
        { name: "cbet_made", type: "INT NOT NULL DEFAULT 0" },
        { name: "faced_cbet", type: "INT NOT NULL DEFAULT 0" },
        { name: "folded_to_cbet", type: "INT NOT NULL DEFAULT 0" },
        { name: "saw_flop", type: "INT NOT NULL DEFAULT 0" },
        { name: "went_to_showdown", type: "INT NOT NULL DEFAULT 0" },
        { name: "three_bet_opportunities", type: "INT NOT NULL DEFAULT 0" },
        { name: "three_bet_made", type: "INT NOT NULL DEFAULT 0" },
        { name: "faced_three_bet", type: "INT NOT NULL DEFAULT 0" },
        { name: "folded_to_three_bet", type: "INT NOT NULL DEFAULT 0" },
        { name: "postflop_checks", type: "INT NOT NULL DEFAULT 0" },
      ];
      for (const col of newColumns) {
        try {
          this.db.exec(
            `ALTER TABLE PlayerStats ADD COLUMN ${col.name} ${col.type}`,
          );
        } catch (_) {
          // Column already exists, ignore
        }
      }
    } catch (err) {
      console.log("Failed to create player table", err.message);
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async query(sql: string, params: Array<any>): Promise<Array<any>> {
    const stmt = this.db.prepare(sql);
    const sqlTrimmed = sql.trim().toUpperCase();
    if (sqlTrimmed.startsWith("SELECT")) {
      return stmt.all(...params) as any[];
    } else {
      stmt.run(...params);
      return [];
    }
  }
}

const db_service = new DBService("./app/pokernow-gpt.db");

export default db_service;
