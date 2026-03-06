import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

import { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import { sleep } from "./helpers/bot-helper.ts";
import {
  AIService,
  BotAction,
  defaultCheckAction,
  defaultFoldAction,
} from "./interfaces/ai-client-interfaces.ts";
import { ProcessedLogs } from "./interfaces/log-processing-interfaces.ts";
import { AIConfig, BotConfig } from "./interfaces/config-interfaces.ts";

import { Game } from "./models/game.ts";
import { Table } from "./models/table.ts";

import { LogService } from "./services/log-service.ts";
import { DBService } from "./services/db-service.ts";
import { PlayerService } from "./services/player-service.ts";
import { AIServiceFactory } from "./helpers/ai-service-factory.ts";

import { constructQuery } from "./helpers/construct-query-helper.ts";
import { DebugMode } from "./utils/error-handling-utils.ts";
import {
  postProcessLogs,
  postProcessLogsAfterHand,
  preProcessLogs,
} from "./utils/log-processing-utils.ts";
import {
  getIdToInitialStackFromMsg,
  getIdToNameFromMsg,
  getIdToTableSeatFromMsg,
  getNameToIdFromMsg,
  getPlayerStacksMsg,
  getTableSeatToIdFromMsg,
  validateAllMsg,
} from "./utils/message-processing-utils.ts";
import {
  convertToBBs,
  convertToValue,
} from "./utils/value-conversion-utils.ts";

import ai_config_json from "./configs/ai-config.json" with { type: "json" };
import bot_config_json from "./configs/bot-config.json" with { type: "json" };

const AI_CONFIG_PATH = path.resolve("./app/configs/ai-config.json");
const PROMPT_DIR = path.resolve("./app/configs");

export class BotServer {
  private app: express.Application;
  private port: number;

  // Services
  private ai_service!: AIService;
  private log_service!: LogService;
  private player_service!: PlayerService;
  private db_service!: DBService;

  // Game state
  private game!: Game;
  private table!: Table;
  private bot_name: string = "";
  private game_id: string = "";
  private config_version: number = 0;
  private debug_mode: DebugMode;
  private query_retries: number;

  // Hand state
  private first_created: string = "";
  private hand_history: ChatCompletionMessageParam | any = [];
  private processed_logs: ProcessedLogs = {
    valid_msgs: [],
    last_created: "",
    first_fetch: true,
  };
  private initialized: boolean = false;
  private current_hand_num: number = 0;

  constructor(port: number = 3000) {
    this.port = port;
    this.app = express();

    const bot_config: BotConfig = bot_config_json;
    this.debug_mode = bot_config.debug_mode;
    this.query_retries = bot_config.query_retries;

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(express.json());

    // CORS for chrome extension
    this.app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept",
      );
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        return res.sendStatus(200);
      }
      next();
    });
  }

  private setupRoutes() {
    this.app.get("/api/health", (req, res) => {
      res.json({
        status: "ok",
        initialized: this.initialized,
        game_id: this.game_id,
        bot_name: this.bot_name,
        config_version: this.config_version,
      });
    });

    this.app.post("/api/init", async (req, res) => {
      try {
        const {
          game_id,
          bot_name,
          game_type,
          big_blind,
          small_blind,
          num_players,
        } = req.body;

        this.game_id = game_id;
        this.bot_name = bot_name;

        // Init DB
        this.db_service = new DBService("./app/pokernow-gpt.db");
        await this.db_service.init();

        // Init player service
        this.player_service = new PlayerService(this.db_service);

        // Init log service (fetch-based, no puppeteer)
        this.log_service = new LogService(game_id);
        await this.log_service.initFetchMode();

        // Init AI service
        await this.initAIService();

        // Create table and game
        this.table = new Table(this.player_service);
        this.table.setNumPlayers(num_players);
        this.game = new Game(
          game_id,
          this.table,
          big_blind,
          small_blind,
          game_type,
          30,
        );

        // Reset hand state
        this.first_created = "";
        this.hand_history = [];
        this.processed_logs = {
          valid_msgs: [],
          last_created: "",
          first_fetch: true,
        };

        this.initialized = true;
        console.log(
          `[Server] Initialized for game ${game_id}, playing as ${bot_name}`,
        );
        res.json({ status: "ok" });
      } catch (err: any) {
        console.error("[Server] Init error:", err);
        res.status(500).json({ status: "error", message: err.message });
      }
    });

    this.app.post("/api/action", async (req, res) => {
      if (!this.initialized) {
        return res
          .status(400)
          .json({ status: "error", message: "Not initialized" });
      }

      try {
        const {
          hand,
          pot_size,
          stack_size,
          num_players,
          game_type,
          big_blind,
          small_blind,
          available_actions,
          hand_num,
          community_cards,
        } = req.body;

        // Auto-detect new hand if hand-start was missed
        if (hand_num && hand_num !== this.current_hand_num) {
          console.log(
            `[Server] New hand detected via action request (hand ${hand_num}, was ${this.current_hand_num}). Auto-resetting.`,
          );
          this.current_hand_num = hand_num;
          this.game.updateGameTypeAndBlinds(small_blind, big_blind, game_type);
          this.table.nextHand();
          this.table.setNumPlayers(num_players);
          this.table.setPlayersInPot(num_players);
          this.hand_history = [];
          this.processed_logs = {
            valid_msgs: [],
            last_created: this.first_created,
            first_fetch: true,
          };
        }

        // Update game info
        this.game.updateGameTypeAndBlinds(small_blind, big_blind, game_type);
        this.table.setNumPlayers(num_players);
        this.table.setPlayersInPot(num_players);

        // Pull and process logs
        try {
          await sleep(500);
          this.processed_logs = await this.pullAndProcessLogs(
            this.processed_logs.last_created,
            this.processed_logs.first_fetch,
          );
        } catch (err) {
          console.log("[Server] Failed to pull logs:", err);
        }

        // Update pot and hero
        const pot_numeric = parseFloat(pot_size) || 0;
        const stack_numeric = parseFloat(stack_size) || 0;
        this.table.setPot(convertToBBs(pot_numeric, this.game.getBigBlind()));

        const hero_stack_bbs = convertToBBs(
          stack_numeric,
          this.game.getBigBlind(),
        );
        const hero = this.game.getHero();
        if (!hero) {
          this.game.createAndSetHero(
            this.table.getIdFromName(this.bot_name),
            hand,
            hero_stack_bbs,
          );
        } else {
          hero.setHand(hand);
          hero.setStackSize(hero_stack_bbs);
        }

        // Post-process logs and construct query
        let bot_action: BotAction;
        try {
          await postProcessLogs(this.table.getLogsQueue(), this.game);

          // Override street/runout with DOM-sourced community cards (source of truth)
          if (community_cards && Array.isArray(community_cards)) {
            if (community_cards.length === 0) {
              this.table.setStreet("");
              this.table.setRunout("");
            } else {
              const boardStr = community_cards.join(", ");
              if (community_cards.length <= 3) {
                this.table.setStreet("flop");
              } else if (community_cards.length === 4) {
                this.table.setStreet("turn");
              } else {
                this.table.setStreet("river");
              }
              // Format: first 3 in brackets, 4th in brackets, 5th in brackets
              // e.g. "[8s, 7c, 10d]" or "[8s, 7c, 10d] [Ks]" or "[8s, 7c, 10d] [Ks] [2h]"
              let runout = " [" + community_cards.slice(0, 3).join(", ") + "]";
              if (community_cards.length >= 4) {
                runout += " [" + community_cards[3] + "]";
              }
              if (community_cards.length >= 5) {
                runout += " [" + community_cards[4] + "]";
              }
              this.table.setRunout(runout);
            }
          }

          const query = constructQuery(this.game);
          console.log("[Server] Query constructed, querying AI...");
          bot_action = await this.queryBotAction(query, this.query_retries);
          this.table.resetPlayerActions();
        } catch (err) {
          console.error(
            "[Server] Error constructing query or querying AI:",
            err,
          );
          bot_action = available_actions?.check
            ? defaultCheckAction
            : defaultFoldAction;
        }

        // Validate against available actions
        bot_action = this.validateAgainstAvailable(
          bot_action,
          available_actions,
          hero_stack_bbs,
        );

        // Convert bet size from BBs to chip value
        let amount = 0;
        if (bot_action.bet_size_in_BBs > 0) {
          amount = convertToValue(
            bot_action.bet_size_in_BBs,
            this.game.getBigBlind(),
          );
        }
        if (bot_action.action_str === "all-in") {
          amount = convertToValue(hero_stack_bbs, this.game.getBigBlind());
        }

        console.log(
          `[Server] Action: ${bot_action.action_str}, Amount: ${amount}`,
        );

        res.json({
          action: bot_action.action_str,
          amount: amount,
        });
      } catch (err: any) {
        console.error("[Server] Action error:", err);
        res.json({ action: "check", amount: 0 });
      }
    });

    this.app.post("/api/hand-start", async (req, res) => {
      if (!this.initialized) {
        return res
          .status(400)
          .json({ status: "error", message: "Not initialized" });
      }

      try {
        const { num_players, game_type, big_blind, small_blind } = req.body;

        this.game.updateGameTypeAndBlinds(small_blind, big_blind, game_type);
        this.hand_history = [];
        this.table.nextHand();
        this.table.setNumPlayers(num_players);
        this.table.setPlayersInPot(num_players);
        if (num_players) this.current_hand_num++;

        // Reset processed_logs for new hand
        this.processed_logs = {
          valid_msgs: [],
          last_created: this.first_created,
          first_fetch: true,
        };

        console.log(
          `[Server] Hand started. Players: ${num_players}, Blinds: ${small_blind}/${big_blind}`,
        );
        res.json({ status: "ok" });
      } catch (err: any) {
        console.error("[Server] Hand start error:", err);
        res.status(500).json({ status: "error", message: err.message });
      }
    });

    this.app.post("/api/hand-end", async (req, res) => {
      if (!this.initialized) {
        return res
          .status(400)
          .json({ status: "error", message: "Not initialized" });
      }

      try {
        const { stack_size } = req.body;
        console.log("[Server] Hand ended. Stack:", stack_size);

        // Process end-of-hand logs
        try {
          const processed = await this.pullAndProcessLogs(
            this.first_created,
            this.processed_logs.first_fetch,
          );
          await postProcessLogsAfterHand(processed.valid_msgs, this.game);
          await this.table.processPlayers();
        } catch (err) {
          console.log("[Server] Failed to process end-of-hand:", err);
        }

        res.json({ status: "ok" });
      } catch (err: any) {
        console.error("[Server] Hand end error:", err);
        res.status(500).json({ status: "error", message: err.message });
      }
    });
  }

  private loadCustomPrompt(ai_config: AIConfig): string {
    // If a file is specified, read from that file
    if (ai_config.custom_prompt_file) {
      const promptPath = path.resolve(PROMPT_DIR, ai_config.custom_prompt_file);
      try {
        return fs.readFileSync(promptPath, "utf-8").trim();
      } catch (err) {
        console.warn(
          `[Server] Could not read custom prompt file "${promptPath}":`,
          err,
        );
      }
    }
    // Fall back to inline custom_prompt string
    return ai_config.custom_prompt ?? "";
  }

  private async initAIService() {
    dotenv.config();
    const ai_config: AIConfig = ai_config_json;

    const factory = new AIServiceFactory();
    this.ai_service = factory.createAIService(
      ai_config.provider,
      ai_config.model_name,
      ai_config.playstyle,
    );

    const customPrompt = this.loadCustomPrompt(ai_config);
    if (customPrompt) {
      this.ai_service.setCustomPrompt(customPrompt);
    }
    this.ai_service.init();

    console.log(
      `[Server] AI service: ${ai_config.provider} ${ai_config.model_name} (${ai_config.playstyle})`,
    );
    if (customPrompt.length > 0) {
      const preview = customPrompt.substring(0, 80).replace(/\n/g, " ");
      console.log(
        `[Server] Custom prompt: "${preview}${customPrompt.length > 80 ? "..." : ""}"`,
      );
      if (ai_config.custom_prompt_file) {
        console.log(`[Server] Loaded from: ${ai_config.custom_prompt_file}`);
      }
    }

    this.watchAIConfig();
  }

  private watchAIConfig() {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const reloadConfig = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          const raw = fs.readFileSync(AI_CONFIG_PATH, "utf-8");
          const updated: AIConfig = JSON.parse(raw);
          const newPlaystyle = updated.playstyle ?? "neutral";
          const newCustomPrompt = this.loadCustomPrompt(updated);
          this.ai_service.setPlaystyle(newPlaystyle);
          this.ai_service.setCustomPrompt(newCustomPrompt);
          this.config_version++;
          if (newCustomPrompt && newCustomPrompt.trim().length > 0) {
            const preview = newCustomPrompt
              .substring(0, 80)
              .replace(/\n/g, " ");
            console.log(
              `\n[Strategy updated] Custom prompt: "${preview}${newCustomPrompt.length > 80 ? "..." : ""}"`,
            );
          } else {
            console.log(`\n[Strategy updated] Playstyle: ${newPlaystyle}`);
          }
        } catch (err) {
          console.log("[Strategy watcher] Failed to reload:", err);
        }
      }, 300);
    };

    // Watch the ai-config.json
    fs.watch(AI_CONFIG_PATH, reloadConfig);

    // Also watch the prompt file if specified
    const ai_config: AIConfig = ai_config_json;
    if (ai_config.custom_prompt_file) {
      const promptPath = path.resolve(PROMPT_DIR, ai_config.custom_prompt_file);
      try {
        fs.watch(promptPath, () => {
          console.log("[Strategy watcher] Prompt file changed, reloading...");
          reloadConfig();
        });
      } catch (err) {
        console.warn("[Strategy watcher] Could not watch prompt file:", err);
      }
    }
  }

  private async pullAndProcessLogs(
    last_created: string,
    first_fetch: boolean,
  ): Promise<ProcessedLogs> {
    const log = await this.log_service.fetchData("", last_created);
    if (log.code === "success") {
      let data = this.log_service.getData(log);
      let msg = this.log_service.getMsg(data);
      if (first_fetch) {
        data = this.log_service.pruneLogsBeforeCurrentHand(data);
        msg = this.log_service.getMsg(data);
        this.table.setPlayerInitialStacksFromMsg(msg, this.game.getBigBlind());

        first_fetch = false;
        this.first_created = this.log_service.getLast(
          this.log_service.getCreatedAt(data),
        );

        let stack_msg = getPlayerStacksMsg(msg);
        let id_to_stack_map = getIdToInitialStackFromMsg(
          stack_msg,
          this.game.getBigBlind(),
        );
        this.table.setIdToStack(id_to_stack_map);

        let seat_to_id_map = getTableSeatToIdFromMsg(stack_msg);
        this.table.setTableSeatToId(seat_to_id_map);

        let id_to_seat_map = getIdToTableSeatFromMsg(stack_msg);
        this.table.setIdToTableSeat(id_to_seat_map);

        let id_to_name_map = getIdToNameFromMsg(stack_msg);
        this.table.setIdToName(id_to_name_map);

        let name_to_id_map = getNameToIdFromMsg(stack_msg);
        this.table.setNameToId(name_to_id_map);

        await this.table.updateCache();
      }

      let only_valid = validateAllMsg(msg);
      preProcessLogs(only_valid, this.game);
      let first_seat_number = this.table.getSeatNumberFromId(
        this.table.getFirstSeatOrderId(),
      );
      if (first_seat_number === undefined) {
        console.warn(
          `[Server] Could not find seat for SB player ${this.table.getFirstSeatOrderId()}, defaulting to seat 1`,
        );
        first_seat_number = 1;
      }
      this.table.setIdToPosition(first_seat_number);
      this.table.convertAllOrdersToPosition();

      last_created = this.log_service.getFirst(
        this.log_service.getCreatedAt(data),
      );
      return {
        valid_msgs: only_valid,
        last_created: last_created,
        first_fetch: first_fetch,
      };
    } else {
      throw new Error("Failed to pull logs.");
    }
  }

  private async queryBotAction(
    query: string,
    retries: number,
    retry_counter: number = 0,
  ): Promise<BotAction> {
    if (retry_counter > retries) {
      console.log(`[Server] Exceeded retry limit (${retries}). Defaulting.`);
      return defaultCheckAction;
    }
    try {
      await sleep(1000);
      const ai_response = await this.ai_service.query(query, this.hand_history);
      this.hand_history = ai_response.prev_messages;

      if (this.isValidAction(ai_response.bot_action)) {
        if (ai_response.curr_message) {
          this.hand_history.push(ai_response.curr_message);
        }
        return ai_response.bot_action;
      }
      console.log("[Server] Invalid bot action, retrying.");
      return this.queryBotAction(query, retries, retry_counter + 1);
    } catch (err) {
      console.log("[Server] AI query error:", err, "retrying.");
      return this.queryBotAction(query, retries, retry_counter + 1);
    }
  }

  private isValidAction(bot_action: BotAction): boolean {
    const valid = ["bet", "raise", "call", "check", "fold", "all-in"];
    return !!(bot_action.action_str && valid.includes(bot_action.action_str));
  }

  private validateAgainstAvailable(
    bot_action: BotAction,
    available: any,
    stack_bbs: number,
  ): BotAction {
    if (!available) return bot_action;

    const action = bot_action.action_str;

    // Check if the chosen action is available
    switch (action) {
      case "check":
        if (available.check) return bot_action;
        break;
      case "call":
        if (available.call && bot_action.bet_size_in_BBs <= stack_bbs)
          return bot_action;
        break;
      case "fold":
        if (available.fold) return bot_action;
        break;
      case "bet":
      case "raise":
        if (
          available.raise &&
          bot_action.bet_size_in_BBs > 0 &&
          bot_action.bet_size_in_BBs <= stack_bbs
        )
          return bot_action;
        break;
      case "all-in":
        if (available.raise) return bot_action;
        break;
    }

    // Fallback
    if (available.check) return defaultCheckAction;
    if (available.fold) return defaultFoldAction;
    return defaultCheckAction;
  }

  async start() {
    return new Promise<void>((resolve) => {
      this.app.listen(this.port, () => {
        console.log(
          `\n[Server] PokerNow GPT Bot server running on http://localhost:${this.port}`,
        );
        console.log("[Server] Waiting for Chrome extension to connect...\n");
        resolve();
      });
    });
  }
}
