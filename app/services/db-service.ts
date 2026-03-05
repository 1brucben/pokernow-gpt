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
                    pfr_stat REAL AS (pfr_hands / CAST((total_hands - walks) AS REAL))
                );
            `);
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
