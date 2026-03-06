import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import prompt from "prompt-sync";

import { Bot } from "./bot.ts";

import ai_config_json from "./configs/ai-config.json" with { type: "json" };
import bot_config_json from "./configs/bot-config.json" with { type: "json" };
import webdriver_config_json from "./configs/webdriver-config.json" with { type: "json" };

import { DBService } from "./services/db-service.ts";
import { LogService } from "./services/log-service.ts";
import { PlayerService } from "./services/player-service.ts";
import { PuppeteerService } from "./services/puppeteer-service.ts";

import {
  AIConfig,
  BotConfig,
  WebDriverConfig,
} from "./interfaces/config-interfaces.ts";
import { AIServiceFactory } from "./helpers/ai-service-factory.ts";
import { AIService } from "./interfaces/ai-client-interfaces.ts";

const io = prompt();
const ai_config: AIConfig = ai_config_json;
const bot_config: BotConfig = bot_config_json;
const webdriver_config: WebDriverConfig = webdriver_config_json;

const AI_CONFIG_PATH = path.resolve("./app/configs/ai-config.json");

function watchAIConfig(ai_service: AIService): void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  fs.watch(AI_CONFIG_PATH, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const raw = fs.readFileSync(AI_CONFIG_PATH, "utf-8");
        const updated: AIConfig = JSON.parse(raw);

        const newPlaystyle = updated.playstyle ?? "neutral";
        const newCustomPrompt = updated.custom_prompt ?? "";

        ai_service.setPlaystyle(newPlaystyle);
        ai_service.setCustomPrompt(newCustomPrompt);

        if (newCustomPrompt && newCustomPrompt.trim().length > 0) {
          console.log(
            `\n[Strategy updated] Using custom prompt: "${newCustomPrompt.substring(0, 80)}${newCustomPrompt.length > 80 ? "..." : ""}"`,
          );
        } else {
          console.log(
            `\n[Strategy updated] Using preset playstyle: ${newPlaystyle}`,
          );
        }
        console.log("The new strategy will take effect on the next hand.\n");
      } catch (err) {
        console.log("[Strategy watcher] Failed to reload ai-config.json:", err);
      }
    }, 300);
  });
  console.log(`Watching ${AI_CONFIG_PATH} for strategy changes.`);
}

function init(): string {
  dotenv.config();
  return io(
    "Enter the PokerNow game id (ex: https://www.pokernow.com/games/{game_id}): ",
  );
}

const bot_manager = async function () {
  let game_id: string;

  const puppeteer_service = new PuppeteerService(
    webdriver_config.default_timeout,
    webdriver_config.headless_flag,
    webdriver_config.connect_to_existing,
    webdriver_config.remote_debugging_port,
  );

  if (webdriver_config.connect_to_existing) {
    dotenv.config();
    await puppeteer_service.init();
    const detected_id = puppeteer_service.getGameIdFromUrl();
    if (detected_id) {
      game_id = detected_id;
      console.log(`Detected game id from browser tab: ${game_id}`);
    } else {
      throw new Error("Could not detect game id from the open browser tab.");
    }
  } else {
    game_id = init();
    await puppeteer_service.init();
  }

  const db_service = new DBService("./app/pokernow-gpt.db");
  await db_service.init();

  const player_service = new PlayerService(db_service);

  const log_service = new LogService(game_id);
  await log_service.init();

  const ai_service_factory = new AIServiceFactory();
  ai_service_factory.printSupportedModels();
  const ai_service = ai_service_factory.createAIService(
    ai_config.provider,
    ai_config.model_name,
    ai_config.playstyle,
  );
  if (ai_config.custom_prompt) {
    ai_service.setCustomPrompt(ai_config.custom_prompt);
  }
  console.log(
    `Created AI service: ${ai_config.provider} ${ai_config.model_name} with playstyle: ${ai_config.playstyle}`,
  );
  if (ai_config.custom_prompt && ai_config.custom_prompt.trim().length > 0) {
    console.log(
      `Custom prompt active: "${ai_config.custom_prompt.substring(0, 80)}${ai_config.custom_prompt.length > 80 ? "..." : ""}"`,
    );
  }
  ai_service.init();

  watchAIConfig(ai_service);

  const bot = new Bot(
    log_service,
    ai_service,
    player_service,
    puppeteer_service,
    game_id,
    bot_config.debug_mode,
    bot_config.query_retries,
  );
  await bot.run();
};

export default bot_manager;
