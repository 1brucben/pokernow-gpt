import { expect } from "chai";
import { Game } from "../../app/models/game.ts";
import { Hero, Player } from "../../app/models/player.ts";
import { PlayerAction } from "../../app/models/player-action.ts";
import { PlayerStats } from "../../app/models/player-stats.ts";
import { Table } from "../../app/models/table.ts";

import { DBService } from "../../app/services/db-service.ts";
import { LogService } from "../../app/services/log-service.ts";
import { PlayerService } from "../../app/services/player-service.ts";

import {
  SUCCESS_RESPONSE,
  ERROR_RESPONSE,
} from "../../app/utils/error-handling-utils.ts";
import {
  postProcessLogs,
  postProcessLogsAfterHand,
  preProcessLogs,
} from "../../app/utils/log-processing-utils.ts";
import { validateAllMsg } from "../../app/utils/message-processing-utils.ts";
import {
  constructQuery,
  defineRank,
} from "../../app/helpers/construct-query-helper.ts";
import { shouldResetForEmptyBoard } from "../../app/helpers/hand-state-helper.ts";
import { Data } from "../../app/interfaces/log-processing-interfaces.ts";

describe("query service test", async () => {
  it("should properly get logs and filter through them", async () => {
    const log_service = new LogService("pglrRhwA65bP08G-KFoygFwoC");
    await log_service.init();

    const db_service = new DBService("./pokernow-gpt-test.db");
    await db_service.init();
    const player_service = new PlayerService(db_service);

    const log = await log_service.fetchData("", "");
    if (log.code === SUCCESS_RESPONSE) {
      //console.log('success', log.data)
      const res1 = log_service.getMsg(log_service.getData(log));
      const prune = log_service.getMsg(
        log_service.pruneLogsBeforeCurrentHand(log_service.getData(log)),
      );
      const prune_verify = validateAllMsg(prune);
      const pruneres = validateAllMsg(prune);
      const g = new Game("11", new Table(player_service), 10, 5, "NLH", 30);
      const t = g.getTable();
      let hero_stats = new PlayerStats("aa");
      let hero = new Hero("xdd", hero_stats, ["4♣", "4♥"], 10);
      g.setHero(hero);
      t.nextHand();
      preProcessLogs(pruneres, g);
      postProcessLogsAfterHand(prune_verify, g);
      t.setPlayerInitialStacksFromMsg(res1, 10);
      t.processPlayers();
      t.convertAllOrdersToPosition();

      postProcessLogs(t.getLogsQueue(), g);
      //console.log("player_actions", t.getPlayerActions());

      /* const stacks_msg = defineStacks(t);
            console.log("stacks query", stacks_msg);

            const action_msg = defineActions(t);
            console.log("action query", action_msg);

            const stats_msg = defineStats(t);
            console.log("stats query", stats_msg);

            const name_to_id = t.getNameToID();
            console.log(name_to_id); */

      //let query = constructQuery(g)

      let query =
        "Help me decide my action in No Limit Hold'em poker. I'm in the BB with a stack size of 49.5 BBs. \n" +
        "My hole cards are: A♠, 3♣\n" +
        "The current street is: flop and it is 2-handed.\n" +
        "The current community cards are:  [7♦, A♦, 3♥]\n" +
        "Here are the initial stack sizes of all players involved: \n" +
        "SB: 76.7 BBs, BB: 49.5 BBs\n" +
        "Here are the current actions that are relevant:\n" +
        "SB posts 0.5 BB, BB posts 1 BB, SB calls 1 BB, BB checks\n" +
        "Stats of players in the pot:\n" +
        "SB: VPIP: 85.71428571428571, PFR: 0\n" +
        "BB: VPIP: 0, PFR: 0\n" +
        "Please respond in this format: {action,bet_size_in_BBs}";
    }

    if (log.code === ERROR_RESPONSE) {
      console.log("error", log.error);
    }
    db_service.close();
  });
});

describe("constructQuery action history", () => {
  it("includes previous street actions on later streets", async () => {
    const db_service = new DBService(":memory:");
    await db_service.init();
    await db_service.createTables();

    const player_service = new PlayerService(db_service);
    const table = new Table(player_service);
    const game = new Game("test", table, 2, 1, "NLH", 30);

    table.nextHand();
    table.setPlayersInPot(2);
    table.setPot(18);
    table.setStreet("turn");
    table.setRunout("[Ah, 7d, 3c] [Ks]");

    const hero_stats = new PlayerStats("Hero");
    const villain_stats = new PlayerStats("Villain");
    await player_service.create(hero_stats.toJSON());
    await player_service.create(villain_stats.toJSON());

    const hero = new Hero("hero-id", hero_stats, ["As", "Kd"], 95);
    game.setHero(hero);

    // @ts-ignore test setup for table internals
    table["id_to_name"] = new Map([
      ["hero-id", "Hero"],
      ["villain-id", "Villain"],
    ]);
    // @ts-ignore test setup for table internals
    table["name_to_id"] = new Map([
      ["Hero", "hero-id"],
      ["Villain", "villain-id"],
    ]);
    // @ts-ignore test setup for table internals
    table["id_to_position"] = new Map([
      ["hero-id", "BTN"],
      ["villain-id", "BB"],
    ]);
    // @ts-ignore test setup for table internals
    table["id_to_initial_stacks"] = new Map([
      ["hero-id", 100],
      ["villain-id", 100],
    ]);
    // @ts-ignore test setup for table internals
    table["name_to_player"] = new Map([
      ["Hero", hero],
      ["Villain", new Player("villain-id", villain_stats)],
    ]);

    table.updatePlayerActions(
      new PlayerAction("villain-id", "raises", 3, "preflop"),
    );
    table.updatePlayerActions(
      new PlayerAction("hero-id", "calls", 3, "preflop"),
    );
    table.resetPlayerActions();
    table.updatePlayerActions(
      new PlayerAction("villain-id", "checks", 0, "flop"),
    );
    table.updatePlayerActions(new PlayerAction("hero-id", "bets", 4, "flop"));
    table.updatePlayerActions(
      new PlayerAction("villain-id", "calls", 4, "flop"),
    );
    table.resetPlayerActions();
    table.updatePlayerActions(
      new PlayerAction("villain-id", "checks", 0, "turn"),
    );

    const query = constructQuery(game);

    expect(query).to.contain("Hand history so far, grouped by street:");
    expect(query).to.contain("preflop: {BB bets 3 BB}, {BTN calls 3 BB}");
    expect(query).to.contain(
      "flop: {BB checks}, {BTN bets 4 BB}, {BB calls 4 BB}",
    );
    expect(query).to.contain("turn: {BB checks}");

    db_service.close();
  });

  it("derives preflop pot size from action history when the displayed pot lags", async () => {
    const db_service = new DBService(":memory:");
    await db_service.init();
    await db_service.createTables();

    const player_service = new PlayerService(db_service);
    const table = new Table(player_service);
    const game = new Game("test", table, 2, 1, "NLH", 30);

    table.nextHand();
    table.setPlayersInPot(4);
    table.setPot(0);
    table.setStreet("");

    const hero_stats = new PlayerStats("Hero");
    const sb_stats = new PlayerStats("SB");
    const bb_stats = new PlayerStats("BB");
    const utg_stats = new PlayerStats("UTG");
    await player_service.create(hero_stats.toJSON());
    await player_service.create(sb_stats.toJSON());
    await player_service.create(bb_stats.toJSON());
    await player_service.create(utg_stats.toJSON());

    const hero = new Hero("hero-id", hero_stats, ["Qh", "5d"], 100);
    game.setHero(hero);

    // @ts-ignore test setup for table internals
    table["id_to_name"] = new Map([
      ["hero-id", "Hero"],
      ["sb-id", "SB"],
      ["bb-id", "BB"],
      ["utg-id", "UTG"],
    ]);
    // @ts-ignore test setup for table internals
    table["name_to_id"] = new Map([
      ["Hero", "hero-id"],
      ["SB", "sb-id"],
      ["BB", "bb-id"],
      ["UTG", "utg-id"],
    ]);
    // @ts-ignore test setup for table internals
    table["id_to_position"] = new Map([
      ["hero-id", "BU"],
      ["sb-id", "SB"],
      ["bb-id", "BB"],
      ["utg-id", "UTG"],
    ]);
    // @ts-ignore test setup for table internals
    table["id_to_initial_stacks"] = new Map([
      ["hero-id", 100],
      ["sb-id", 100],
      ["bb-id", 100],
      ["utg-id", 100],
    ]);
    // @ts-ignore test setup for table internals
    table["name_to_player"] = new Map([
      ["Hero", hero],
      ["SB", new Player("sb-id", sb_stats)],
      ["BB", new Player("bb-id", bb_stats)],
      ["UTG", new Player("utg-id", utg_stats)],
    ]);

    table.updatePlayerActions(
      new PlayerAction("sb-id", "posts", 0.5, "preflop"),
    );
    table.updatePlayerActions(new PlayerAction("bb-id", "posts", 1, "preflop"));
    table.updatePlayerActions(
      new PlayerAction("utg-id", "calls", 1, "preflop"),
    );

    const query = constructQuery(game);

    expect(query).to.contain(
      "The current pot size is approximately 2.5 BB based on the betting history. The UI-reported pot currently reads 0 BB, so use the betting history as the source of truth.",
    );

    db_service.close();
  });

  it("detects stale postflop state when a new request has an empty board", async () => {
    const db_service = new DBService(":memory:");
    await db_service.init();
    await db_service.createTables();

    const player_service = new PlayerService(db_service);
    const table = new Table(player_service);

    table.nextHand();
    table.setStreet("river");
    table.setRunout("[7s, 9s, Ts] [Ac] [7c]");
    table.updatePlayerActions(
      new PlayerAction("villain-id", "bets", 7.5, "river"),
    );

    expect(shouldResetForEmptyBoard(table, [])).to.equal(true);
    expect(shouldResetForEmptyBoard(table, ["7s", "9s", "Ts"])).to.equal(false);

    table.nextHand();
    table.updatePlayerActions(
      new PlayerAction("villain-id", "posts", 0.5, "preflop"),
    );

    expect(shouldResetForEmptyBoard(table, [])).to.equal(false);

    db_service.close();
  });

  it("waits for a starting hand log before bootstrapping a new hand", () => {
    const log_service = new LogService("test");
    const data: Data = {
      logs: [
        { at: "1", created_at: "1", msg: "foo" },
        undefined as unknown as Data["logs"][number],
        { at: "2", created_at: "2", msg: "bar" },
      ],
    };

    expect(() => log_service.getMsg(data)).to.not.throw();
    expect(log_service.getMsg(data)).to.deep.equal(["foo", "bar"]);
    expect(() => log_service.pruneLogsBeforeCurrentHand(data)).to.not.throw();
    expect(log_service.pruneLogsBeforeCurrentHand(data).logs).to.have.length(0);
  });
});
