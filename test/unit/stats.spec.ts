import { expect } from "chai";
import { Table } from "../../app/models/table.ts";
import { Player } from "../../app/models/player.ts";
import { PlayerStats } from "../../app/models/player-stats.ts";
import { Game } from "../../app/models/game.ts";
import { DBService } from "../../app/services/db-service.ts";
import { PlayerService } from "../../app/services/player-service.ts";
import { postProcessLogsAfterHand } from "../../app/utils/log-processing-utils.ts";

/**
 * Helper: set up a Table + Game with N players pre-cached, backed by an in-memory DB.
 * Returns { table, game, db } so you can close the DB after the test.
 *
 * Players are named "Player1", "Player2", ... with IDs "P1", "P2", ...
 */
async function setupGame(numPlayers: number) {
  const db = new DBService(":memory:");
  await db.init();
  await db.createTables();
  const playerService = new PlayerService(db);
  const table = new Table(playerService);
  const game = new Game("test", table, 20, 10, "NLH", 30);

  table.nextHand();

  const idToName = new Map<string, string>();
  const nameToId = new Map<string, string>();

  for (let i = 1; i <= numPlayers; i++) {
    const id = `P${i}`;
    const name = `Player${i}`;
    idToName.set(id, name);
    nameToId.set(name, id);
    const stats = new PlayerStats(name);
    await playerService.create(stats.toJSON());
    // @ts-ignore – accessing private for test setup
    table["name_to_player"].set(name, new Player(id, stats));
  }

  // @ts-ignore
  table["id_to_name"] = idToName;
  // @ts-ignore
  table["name_to_id"] = nameToId;

  return { table, game, db };
}

/** Shorthand for a player action log entry */
function action(
  playerId: string,
  actionWord: string,
  amount: string = "",
): string[] {
  const playerName = `Player${playerId.slice(1)}`;
  return [
    playerId,
    playerName,
    actionWord,
    `${playerName} ${actionWord}`,
    amount,
  ];
}

/** Shorthand for a street-change log entry */
function street(name: string, cards: string = ""): string[] {
  return [name, cards];
}

/** Get the PlayerStats for a player ID after processing */
function getStats(table: Table, playerId: string): PlayerStats {
  const name = table.getNameFromId(playerId);
  return table.getPlayerStatsFromName(name);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describe("New stats tracking", function () {
  // ── PlayerStats compute methods ──────────────────────────────────────────

  describe("PlayerStats compute methods", () => {
    it("should compute 2nd barrel % correctly", () => {
      const s = new PlayerStats("test");
      expect(s.computeSecondBarrelStat()).to.equal(0); // 0/0 → 0
      s.incrementSecondBarrelOpportunities();
      s.incrementSecondBarrelOpportunities();
      s.incrementSecondBarrelMade();
      expect(s.computeSecondBarrelStat()).to.equal(50); // 1/2 = 50%
    });

    it("should compute 3rd barrel % correctly", () => {
      const s = new PlayerStats("test");
      s.incrementThirdBarrelOpportunities();
      s.incrementThirdBarrelMade();
      expect(s.computeThirdBarrelStat()).to.equal(100);
    });

    it("should compute fold to 2nd barrel % correctly", () => {
      const s = new PlayerStats("test");
      expect(s.computeFoldToSecondBarrelStat()).to.equal(0);
      s.incrementFacedSecondBarrel();
      s.incrementFacedSecondBarrel();
      s.incrementFoldedToSecondBarrel();
      expect(s.computeFoldToSecondBarrelStat()).to.equal(50);
    });

    it("should compute fold to 3rd barrel % correctly", () => {
      const s = new PlayerStats("test");
      s.incrementFacedThirdBarrel();
      s.incrementFoldedToThirdBarrel();
      expect(s.computeFoldToThirdBarrelStat()).to.equal(100);
    });

    it("should compute donk bet % correctly", () => {
      const s = new PlayerStats("test");
      expect(s.computeDonkBetStat()).to.equal(0);
      s.incrementDonkBetOpportunities();
      s.incrementDonkBetOpportunities();
      s.incrementDonkBetOpportunities();
      s.incrementDonkBetMade();
      expect(s.computeDonkBetStat()).to.be.closeTo(33.33, 0.01);
    });

    it("should compute check-raise % correctly", () => {
      const s = new PlayerStats("test");
      expect(s.computeCheckRaiseStat()).to.equal(0);
      s.incrementCheckRaiseOpportunities();
      s.incrementCheckRaiseMade();
      expect(s.computeCheckRaiseStat()).to.equal(100);
    });
  });

  // ── PlayerStats JSON round-trip ──────────────────────────────────────────

  describe("PlayerStats toJSON / fromJSON round-trip", () => {
    it("should serialize and deserialize all new fields", () => {
      const s = new PlayerStats("test");
      s.incrementSecondBarrelOpportunities();
      s.incrementSecondBarrelMade();
      s.incrementThirdBarrelOpportunities();
      s.incrementFacedSecondBarrel();
      s.incrementFoldedToSecondBarrel();
      s.incrementFacedThirdBarrel();
      s.incrementFoldedToThirdBarrel();
      s.incrementDonkBetOpportunities();
      s.incrementDonkBetMade();
      s.incrementCheckRaiseOpportunities();
      s.incrementCheckRaiseMade();

      const json = s.toJSON();
      const restored = new PlayerStats("test", json);

      expect(restored.getSecondBarrelOpportunities()).to.equal(1);
      expect(restored.getSecondBarrelMade()).to.equal(1);
      expect(restored.getThirdBarrelOpportunities()).to.equal(1);
      expect(restored.getThirdBarrelMade()).to.equal(0);
      expect(restored.getFacedSecondBarrel()).to.equal(1);
      expect(restored.getFoldedToSecondBarrel()).to.equal(1);
      expect(restored.getFacedThirdBarrel()).to.equal(1);
      expect(restored.getFoldedToThirdBarrel()).to.equal(1);
      expect(restored.getDonkBetOpportunities()).to.equal(1);
      expect(restored.getDonkBetMade()).to.equal(1);
      expect(restored.getCheckRaiseOpportunities()).to.equal(1);
      expect(restored.getCheckRaiseMade()).to.equal(1);
    });
  });

  // ── Full hand scenario: Triple barrel ────────────────────────────────────

  describe("Scenario: Triple barrel (cbet → 2nd barrel → 3rd barrel)", () => {
    it("should track all three barrels and folds correctly", async () => {
      const { table, game, db } = await setupGame(2);

      const logs: string[][] = [
        // Preflop
        action("P1", "raises", "6"),
        action("P2", "calls", "6"),
        // Flop
        street("Flop", "7♦ A♦ 3♥"),
        action("P2", "checks"),
        action("P1", "bets", "8"), // c-bet
        action("P2", "calls", "8"),
        // Turn
        street("Turn", "7♦ A♦ 3♥ 9♠"),
        action("P2", "checks"),
        action("P1", "bets", "16"), // 2nd barrel
        action("P2", "calls", "16"),
        // River
        street("River", "7♦ A♦ 3♥ 9♠ 2♣"),
        action("P2", "checks"),
        action("P1", "bets", "30"), // 3rd barrel
        action("P2", "folds"),
      ];

      await postProcessLogsAfterHand(logs, game);
      await table.processPlayers();

      const p1 = getStats(table, "P1");
      const p2 = getStats(table, "P2");

      // P1 (PFA): all barrels fired
      expect(p1.getCbetOpportunities()).to.equal(1);
      expect(p1.getCbetMade()).to.equal(1);
      expect(p1.getSecondBarrelOpportunities()).to.equal(1);
      expect(p1.getSecondBarrelMade()).to.equal(1);
      expect(p1.getThirdBarrelOpportunities()).to.equal(1);
      expect(p1.getThirdBarrelMade()).to.equal(1);

      // P2: faced all barrels, called first two, folded to third
      expect(p2.getFacedCbet()).to.equal(1);
      expect(p2.getFoldedToCbet()).to.equal(0);
      expect(p2.getFacedSecondBarrel()).to.equal(1);
      expect(p2.getFoldedToSecondBarrel()).to.equal(0);
      expect(p2.getFacedThirdBarrel()).to.equal(1);
      expect(p2.getFoldedToThirdBarrel()).to.equal(1);

      // P2 had donk bet opportunity on flop (checked instead)
      expect(p2.getDonkBetOpportunities()).to.equal(1);
      expect(p2.getDonkBetMade()).to.equal(0);

      // P2 had check-raise opportunity (checked then faced bet)
      expect(p2.getCheckRaiseOpportunities()).to.equal(1);
      expect(p2.getCheckRaiseMade()).to.equal(0);

      await db.close();
    });
  });

  // ── Scenario: C-bet raised → no barrels ──────────────────────────────────

  describe("Scenario: C-bet raised → no further barrels", () => {
    it("should not track 2nd/3rd barrel when c-bet was raised", async () => {
      const { table, game, db } = await setupGame(2);

      const logs: string[][] = [
        action("P1", "raises", "6"),
        action("P2", "calls", "6"),
        street("Flop", "7♦ A♦ 3♥"),
        action("P2", "checks"),
        action("P1", "bets", "8"), // c-bet
        action("P2", "raises", "24"), // raises the c-bet
        action("P1", "calls", "24"),
        // Turn: PFA bets, but should NOT be tracked as 2nd barrel
        street("Turn", "7♦ A♦ 3♥ 9♠"),
        action("P2", "checks"),
        action("P1", "bets", "30"),
        action("P2", "folds"),
      ];

      await postProcessLogsAfterHand(logs, game);
      await table.processPlayers();

      const p1 = getStats(table, "P1");
      const p2 = getStats(table, "P2");

      // C-bet happened
      expect(p1.getCbetOpportunities()).to.equal(1);
      expect(p1.getCbetMade()).to.equal(1);

      // But NO 2nd barrel because the c-bet was raised
      expect(p1.getSecondBarrelOpportunities()).to.equal(0);
      expect(p1.getSecondBarrelMade()).to.equal(0);

      // P2 raised the c-bet = check-raise
      expect(p2.getCheckRaiseOpportunities()).to.equal(1);
      expect(p2.getCheckRaiseMade()).to.equal(1);

      await db.close();
    });
  });

  // ── Scenario: Donk bet on flop ──────────────────────────────────────────

  describe("Scenario: Donk bet on flop", () => {
    it("should track donk bet and prevent c-bet opportunity", async () => {
      const { table, game, db } = await setupGame(2);

      const logs: string[][] = [
        action("P1", "raises", "6"),
        action("P2", "calls", "6"),
        street("Flop", "7♦ A♦ 3♥"),
        action("P2", "bets", "8"), // donk bet
        action("P1", "calls", "8"),
      ];

      await postProcessLogsAfterHand(logs, game);
      await table.processPlayers();

      const p1 = getStats(table, "P1");
      const p2 = getStats(table, "P2");

      // P2 donk-bet
      expect(p2.getDonkBetOpportunities()).to.equal(1);
      expect(p2.getDonkBetMade()).to.equal(1);

      // P1 (PFA): no c-bet opportunity because of donk bet
      expect(p1.getCbetOpportunities()).to.equal(0);
      expect(p1.getCbetMade()).to.equal(0);

      // No barrels since no c-bet
      expect(p1.getSecondBarrelOpportunities()).to.equal(0);

      await db.close();
    });
  });

  // ── Scenario: Donk bet not tracked for raise over donk ──────────────────

  describe("Scenario: Raise over donk bet not counted as donk", () => {
    it("should only count the first bet as a donk bet", async () => {
      const { table, game, db } = await setupGame(3);

      const logs: string[][] = [
        action("P1", "raises", "6"),
        action("P2", "calls", "6"),
        action("P3", "calls", "6"),
        street("Flop", "7♦ A♦ 3♥"),
        action("P2", "checks"), // donk bet opportunity, didn't take it
        action("P3", "bets", "8"), // donk bet!
        action("P1", "calls", "8"), // PFA calls
        action("P2", "raises", "24"), // P2 raises the donk — NOT a donk bet
      ];

      await postProcessLogsAfterHand(logs, game);
      await table.processPlayers();

      const p2 = getStats(table, "P2");
      const p3 = getStats(table, "P3");

      // P2 had donk opp (checked) but did NOT donk
      expect(p2.getDonkBetOpportunities()).to.equal(1);
      expect(p2.getDonkBetMade()).to.equal(0);

      // P3 donk-bet
      expect(p3.getDonkBetOpportunities()).to.equal(1);
      expect(p3.getDonkBetMade()).to.equal(1);

      // P2's raise is NOT counted as a donk bet
      // (donk_bet_made should still be 0 for P2)
      // This verifies the fix for the "raise over donk" bug

      await db.close();
    });
  });

  // ── Scenario: Check-raise on flop ───────────────────────────────────────

  describe("Scenario: Check-raise on flop", () => {
    it("should track check-raise opportunity and made", async () => {
      const { table, game, db } = await setupGame(2);

      const logs: string[][] = [
        action("P1", "raises", "6"),
        action("P2", "calls", "6"),
        street("Flop", "7♦ A♦ 3♥"),
        action("P2", "checks"),
        action("P1", "bets", "8"),
        action("P2", "raises", "24"), // check-raise!
        action("P1", "calls", "24"),
      ];

      await postProcessLogsAfterHand(logs, game);
      await table.processPlayers();

      const p2 = getStats(table, "P2");

      expect(p2.getCheckRaiseOpportunities()).to.equal(1);
      expect(p2.getCheckRaiseMade()).to.equal(1);

      await db.close();
    });
  });

  // ── Scenario: Check-fold (check-raise opportunity but not taken) ────────

  describe("Scenario: Check-fold (opportunity but no check-raise)", () => {
    it("should track opportunity without made", async () => {
      const { table, game, db } = await setupGame(2);

      const logs: string[][] = [
        action("P1", "raises", "6"),
        action("P2", "calls", "6"),
        street("Flop", "7♦ A♦ 3♥"),
        action("P2", "checks"),
        action("P1", "bets", "8"),
        action("P2", "folds"), // had check-raise opportunity, folded
      ];

      await postProcessLogsAfterHand(logs, game);
      await table.processPlayers();

      const p2 = getStats(table, "P2");

      expect(p2.getCheckRaiseOpportunities()).to.equal(1);
      expect(p2.getCheckRaiseMade()).to.equal(0);

      await db.close();
    });
  });

  // ── Scenario: PFA checks back flop → no barrels ─────────────────────────

  describe("Scenario: PFA checks back flop → no 2nd barrel", () => {
    it("should not track 2nd barrel when PFA didn't c-bet", async () => {
      const { table, game, db } = await setupGame(2);

      const logs: string[][] = [
        action("P1", "raises", "6"),
        action("P2", "calls", "6"),
        street("Flop", "7♦ A♦ 3♥"),
        action("P2", "checks"),
        action("P1", "checks"), // no c-bet
        street("Turn", "7♦ A♦ 3♥ 9♠"),
        action("P2", "checks"),
        action("P1", "bets", "8"), // this is NOT a 2nd barrel
        action("P2", "folds"),
      ];

      await postProcessLogsAfterHand(logs, game);
      await table.processPlayers();

      const p1 = getStats(table, "P1");

      // C-bet opportunity existed but wasn't taken
      expect(p1.getCbetOpportunities()).to.equal(1);
      expect(p1.getCbetMade()).to.equal(0);

      // No barrel tracking since no c-bet
      expect(p1.getSecondBarrelOpportunities()).to.equal(0);

      await db.close();
    });
  });

  // ── Scenario: 2nd barrel but no 3rd ─────────────────────────────────────

  describe("Scenario: C-bet + 2nd barrel, checks river", () => {
    it("should track 2nd barrel opportunity but not 3rd barrel made", async () => {
      const { table, game, db } = await setupGame(2);

      const logs: string[][] = [
        action("P1", "raises", "6"),
        action("P2", "calls", "6"),
        street("Flop", "7♦ A♦ 3♥"),
        action("P2", "checks"),
        action("P1", "bets", "8"), // c-bet
        action("P2", "calls", "8"),
        street("Turn", "7♦ A♦ 3♥ 9♠"),
        action("P2", "checks"),
        action("P1", "bets", "16"), // 2nd barrel
        action("P2", "calls", "16"),
        street("River", "7♦ A♦ 3♥ 9♠ 2♣"),
        action("P2", "checks"),
        action("P1", "checks"), // gives up on river
      ];

      await postProcessLogsAfterHand(logs, game);
      await table.processPlayers();

      const p1 = getStats(table, "P1");

      expect(p1.getCbetMade()).to.equal(1);
      expect(p1.getSecondBarrelMade()).to.equal(1);
      expect(p1.getThirdBarrelOpportunities()).to.equal(1);
      expect(p1.getThirdBarrelMade()).to.equal(0); // checked river

      await db.close();
    });
  });

  // ── Scenario: Multiway donk bet opportunity ─────────────────────────────

  describe("Scenario: Multiway — multiple donk bet opportunities", () => {
    it("should track donk opportunity for all players before PFA", async () => {
      const { table, game, db } = await setupGame(3);

      // P1 (PFA) raises, P2 calls, P3 calls
      // Flop: P2 checks (donk opp, didn't take it), P3 checks (donk opp, didn't take it), P1 bets (c-bet)
      const logs: string[][] = [
        action("P1", "raises", "6"),
        action("P2", "calls", "6"),
        action("P3", "calls", "6"),
        street("Flop", "7♦ A♦ 3♥"),
        action("P2", "checks"),
        action("P3", "checks"),
        action("P1", "bets", "8"), // c-bet
        action("P2", "folds"),
        action("P3", "calls", "8"),
      ];

      await postProcessLogsAfterHand(logs, game);
      await table.processPlayers();

      const p2 = getStats(table, "P2");
      const p3 = getStats(table, "P3");

      // Both had donk bet opportunity (both checked before PFA)
      expect(p2.getDonkBetOpportunities()).to.equal(1);
      expect(p2.getDonkBetMade()).to.equal(0);
      expect(p3.getDonkBetOpportunities()).to.equal(1);
      expect(p3.getDonkBetMade()).to.equal(0);

      await db.close();
    });
  });

  // ── Scenario: Turn barrel raised → no 3rd barrel ────────────────────────

  describe("Scenario: Turn barrel raised → no 3rd barrel", () => {
    it("should not track 3rd barrel when 2nd barrel was raised", async () => {
      const { table, game, db } = await setupGame(2);

      const logs: string[][] = [
        action("P1", "raises", "6"),
        action("P2", "calls", "6"),
        street("Flop", "7♦ A♦ 3♥"),
        action("P2", "checks"),
        action("P1", "bets", "8"), // c-bet
        action("P2", "calls", "8"),
        street("Turn", "7♦ A♦ 3♥ 9♠"),
        action("P2", "checks"),
        action("P1", "bets", "16"), // 2nd barrel
        action("P2", "raises", "48"), // raises the 2nd barrel
        action("P1", "calls", "48"),
        // River
        street("River", "7♦ A♦ 3♥ 9♠ 2♣"),
        action("P2", "checks"),
        action("P1", "bets", "80"), // NOT a 3rd barrel (2nd was raised)
        action("P2", "folds"),
      ];

      await postProcessLogsAfterHand(logs, game);
      await table.processPlayers();

      const p1 = getStats(table, "P1");

      expect(p1.getCbetMade()).to.equal(1);
      expect(p1.getSecondBarrelMade()).to.equal(1);
      // 3rd barrel NOT tracked because the turn barrel was raised
      expect(p1.getThirdBarrelOpportunities()).to.equal(0);
      expect(p1.getThirdBarrelMade()).to.equal(0);

      await db.close();
    });
  });

  // ── Scenario: Fold to 2nd barrel ────────────────────────────────────────

  describe("Scenario: Fold to 2nd barrel", () => {
    it("should track fold to 2nd barrel correctly", async () => {
      const { table, game, db } = await setupGame(2);

      const logs: string[][] = [
        action("P1", "raises", "6"),
        action("P2", "calls", "6"),
        street("Flop", "7♦ A♦ 3♥"),
        action("P2", "checks"),
        action("P1", "bets", "8"),
        action("P2", "calls", "8"),
        street("Turn", "7♦ A♦ 3♥ 9♠"),
        action("P2", "checks"),
        action("P1", "bets", "16"),
        action("P2", "folds"), // folds to 2nd barrel
      ];

      await postProcessLogsAfterHand(logs, game);
      await table.processPlayers();

      const p2 = getStats(table, "P2");

      expect(p2.getFacedSecondBarrel()).to.equal(1);
      expect(p2.getFoldedToSecondBarrel()).to.equal(1);

      await db.close();
    });
  });
});
