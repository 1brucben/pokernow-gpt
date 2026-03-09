// PokerNow GPT Bot - Content Script
// Runs on pokernow.com/games/* pages

(function () {
  "use strict";

  const BACKEND_URL = "http://localhost:3000";
  const POLL_INTERVAL = 500; // ms between DOM checks
  const ACTION_DELAY = 800; // ms delay before executing action
  const BET_TYPE_DELAY = 150; // ms delay between keystrokes when typing bet
  const REQUEST_TIMEOUT = 30000; // ms before aborting a backend request
  const PROCESSING_TIMEOUT = 15000; // ms before force-resetting stuck processing flag
  const SUGGEST_RETRY_ATTEMPTS = 3;
  const SUGGEST_RETRY_DELAY = 900;

  let enabled = false;
  let botName = "";
  let processing = false;
  let processingStartTime = 0; // timestamp when processing was set to true
  let currentHandNum = null;
  let initialized = false;
  let statusOverlay = null;

  // Cached suggestion for current turn
  let cachedSuggestion = null; // { action, amount }
  let turnActive = false;

  // Auto-mode: bot plays automatically without button clicks
  let autoMode = false;
  // Generation counter: incremented each time autoMode is toggled off.
  // Used to detect and abort stale in-flight auto operations.
  let autoGeneration = 0;
  // Guard to prevent re-triggering auto-play after it already ran this turn
  let autoPlayedThisTurn = false;
  // Incremented each time a new turn is detected; used to discard stale AI responses
  let turnGeneration = 0;
  // Guard to prevent overlapping mainLoop iterations (setInterval + async = concurrent)
  let mainLoopRunning = false;

  // Config version tracking (for toast notifications)
  let lastConfigVersion = null;

  // Hero card tracking for reliable new-hand detection
  let lastHeroHandKey = "";
  // Snapshot of community cards at the moment a new hand was detected;
  // until the DOM cards differ from this snapshot, treat them as stale.
  let staleCommunitySnapshot = null;

  // ─── DOM Helpers ────────────────────────────────────────────────

  function getText(selector) {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : null;
  }

  function getGameId() {
    const match = window.location.pathname.match(/\/games\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  function getGameInfo() {
    const raw = getText(".game-infos > .blind-value-ctn > .blind-value");
    if (!raw) return null;
    const re = /([A-Z]+)~\s([0-9]+)\s\/\s([0-9]+)/;
    const m = re.exec(raw);
    if (m && m.length === 4) {
      return {
        game_type: m[1],
        small_blind: Number(m[2]),
        big_blind: Number(m[3]),
      };
    }
    return null;
  }

  function getNumPlayers() {
    const all = document.querySelectorAll(".table-player");
    const sitting = document.querySelectorAll(".table-player-status-icon");
    return all.length - sitting.length;
  }

  function getPotSize() {
    const raw = getText(".table > .table-pot-size > .main-value");
    return raw ? raw : "0";
  }

  function getHand() {
    const cards = [];
    const cardDivs = document.querySelectorAll(
      ".you-player > .table-player-cards > div",
    );
    for (const div of cardDivs) {
      const val = div.querySelector(".value");
      const suit = div.querySelector(".sub-suit");
      if (val && suit) {
        cards.push(val.textContent.trim() + suit.textContent.trim());
      }
    }
    return cards;
  }

  function inspectCommunityCardDOM() {
    const selectors = [
      ".table-cards > .table-card",
      ".table-cards .table-card",
      ".community-cards .card",
      ".table-card",
    ];

    const selectorSummary = selectors.map((selector) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      const samples = nodes.slice(0, 5).map((node) => {
        const value = node.querySelector(".value")?.textContent?.trim() || "";
        const suit = node.querySelector(".sub-suit")?.textContent?.trim() || "";
        return {
          text: node.textContent?.trim() || "",
          value,
          suit,
          className: node.className,
        };
      });
      return {
        selector,
        count: nodes.length,
        samples,
      };
    });

    const tableCardsHtml =
      document.querySelector(".table-cards")?.innerHTML?.substring(0, 800) ||
      null;
    const communityCardsHtml =
      document
        .querySelector(".community-cards")
        ?.innerHTML?.substring(0, 800) || null;

    return {
      selectorSummary,
      tableCardsHtml,
      communityCardsHtml,
    };
  }

  function getCommunityCards() {
    const cards = [];
    // Try multiple selectors in case PokerNow's DOM structure varies
    const selectors = [
      ".table-cards > .table-card",
      ".table-cards .table-card",
      ".community-cards .card",
      ".table-card",
    ];
    let cardDivs = [];
    for (const sel of selectors) {
      cardDivs = document.querySelectorAll(sel);
      if (cardDivs.length > 0) break;
    }
    for (const div of cardDivs) {
      const val = div.querySelector(".value");
      const suit = div.querySelector(".sub-suit");
      if (val && suit) {
        cards.push(val.textContent.trim() + suit.textContent.trim());
      }
    }
    if (cards.length === 0) {
      console.log(
        "[PokerBot] Community card detection returned no cards.",
        inspectCommunityCardDOM(),
      );
    }
    return cards;
  }

  // Returns community cards, filtering out stale cards from the previous hand.
  // After a new hand is detected (hero cards change), community cards
  // are treated as empty until the DOM actually shows different cards.
  function getCommunityCardsPayload() {
    const raw = getCommunityCards();
    console.log(
      "[PokerBot] Raw community cards:",
      raw,
      "Stale snapshot:",
      staleCommunitySnapshot,
    );
    if (staleCommunitySnapshot !== null && staleCommunitySnapshot.length > 0) {
      // Still showing the same cards as when the new hand was detected → stale
      if (raw.join(",") === staleCommunitySnapshot) {
        return {
          cards: [],
          state: "stale-previous-hand",
        };
      }
      // Cards changed → real new community cards, clear the snapshot
      staleCommunitySnapshot = null;
    }

    return {
      cards: raw,
      state: raw.length > 0 ? "visible" : "empty",
    };
  }

  function getStackSize() {
    const raw = getText(
      ".you-player > .table-player-infos-ctn > div > .table-player-stack",
    );
    return raw ? raw : "0";
  }

  function isMyTurn() {
    return !!document.querySelector(".action-signal");
  }

  function isWinner() {
    return !!document.querySelector(".table-player.winner");
  }

  function isWaiting() {
    return !!(
      document.querySelector(".you-player > .waiting") ||
      document.querySelector(".you-player > .waiting-next-hand")
    );
  }

  function getAvailableActions() {
    const actions = {};
    const checkBtn = document.querySelector(
      ".game-decisions-ctn > .action-buttons > .check",
    );
    const callBtn = document.querySelector(
      ".game-decisions-ctn > .action-buttons > .call",
    );
    const foldBtn = document.querySelector(
      ".game-decisions-ctn > .action-buttons > .fold",
    );
    const raiseBtn = document.querySelector(
      ".game-decisions-ctn > .action-buttons > .raise",
    );

    actions.check = checkBtn && !checkBtn.disabled;
    actions.call = callBtn && !callBtn.disabled;
    actions.fold = foldBtn && !foldBtn.disabled;
    actions.raise = raiseBtn && !raiseBtn.disabled;

    return actions;
  }

  // ─── Action Execution ──────────────────────────────────────────

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function executeAction(action, amount) {
    const actionStr = action.toLowerCase();

    await sleep(ACTION_DELAY);

    switch (actionStr) {
      case "check":
        return clickCheck();
      case "call":
        return clickCall();
      case "fold":
        return clickFold();
      case "bet":
      case "raise":
        return clickBetOrRaise(amount);
      case "all-in":
        return clickAllIn();
      default:
        console.warn("[PokerBot] Unknown action:", actionStr);
        return false;
    }
  }

  function clickCheck() {
    const btn = document.querySelector(
      ".game-decisions-ctn > .action-buttons > .check",
    );
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  }

  function clickCall() {
    const btn = document.querySelector(
      ".game-decisions-ctn > .action-buttons > .call",
    );
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  }

  function clickFold() {
    const btn = document.querySelector(
      ".game-decisions-ctn > .action-buttons > .fold",
    );
    if (btn && !btn.disabled) {
      btn.click();
      setTimeout(() => {
        const alertText =
          "Are you sure that you want do an unnecessary fold?Do not show this again in this session? ";
        const alertEl = document.querySelector(".alert-1 > .content");
        if (alertEl && alertEl.textContent === alertText) {
          const cancelBtn = document.querySelector(
            ".alert-1 > .alert-1-buttons > .button-1.red",
          );
          if (cancelBtn) {
            cancelBtn.click();
            setTimeout(() => clickCheck(), 500);
          }
        }
      }, 500);
      return true;
    }
    return false;
  }

  async function clickBetOrRaise(amount) {
    const raiseBtn = document.querySelector(
      ".game-decisions-ctn > .action-buttons > .raise",
    );
    if (!raiseBtn || raiseBtn.disabled) return false;

    const isRaise = raiseBtn.textContent.trim() === "Raise";
    let totalAmount = amount;
    if (isRaise) {
      const betValueEl = document.querySelector(
        ".you-player > .table-player-bet-value",
      );
      if (betValueEl) {
        const currentBet = parseFloat(betValueEl.textContent) || 0;
        totalAmount = amount + currentBet;
      }
    }

    raiseBtn.click();
    await sleep(500);

    const input = document.querySelector(
      ".game-decisions-ctn > form > .raise-bet-value > div > input",
    );
    if (!input) return false;

    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(200);

    const amountStr = totalAmount.toString();
    for (const char of amountStr) {
      input.value += char;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(BET_TYPE_DELAY);
    }

    await sleep(300);
    const betBtn = document.querySelector(
      ".game-decisions-ctn > form > .action-buttons > .bet",
    );
    if (betBtn) {
      betBtn.click();
      return true;
    }
    return false;
  }

  async function clickAllIn() {
    const stackRaw = getStackSize();
    const stack = parseFloat(stackRaw) || 0;
    if (stack > 0) {
      return clickBetOrRaise(stack);
    }
    return false;
  }

  // ─── Backend Communication ─────────────────────────────────────

  async function sendInit() {
    const gameId = getGameId();
    const gameInfo = getGameInfo();
    const numPlayers = getNumPlayers();

    if (!gameId || !gameInfo || !botName) return false;

    try {
      const res = await fetch(`${BACKEND_URL}/api/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          game_id: gameId,
          bot_name: botName,
          game_type: gameInfo.game_type,
          big_blind: gameInfo.big_blind,
          small_blind: gameInfo.small_blind,
          num_players: numPlayers,
        }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        initialized = true;
        console.log("[PokerBot] Backend initialized.");
        return true;
      }
    } catch (err) {
      console.error("[PokerBot] Failed to init backend:", err);
    }
    return false;
  }

  async function requestAction() {
    const gameInfo = getGameInfo();
    if (!gameInfo) return null;

    // Detect new hand by hero card change
    const hand = getHand();
    const handKey = hand.join(",");
    if (lastHeroHandKey && handKey && handKey !== lastHeroHandKey) {
      currentHandNum = (currentHandNum || 0) + 1;
      // Snapshot current DOM community cards as stale
      const boardSnapshot = getCommunityCards().join(",");
      staleCommunitySnapshot = boardSnapshot.length > 0 ? boardSnapshot : null;
      console.log(
        "[PokerBot] New hand detected via card change, hand #" + currentHandNum,
        "stale snapshot:",
        staleCommunitySnapshot,
      );
    }
    if (handKey) lastHeroHandKey = handKey;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    const communityCardsPayload = getCommunityCardsPayload();
    console.log("[PokerBot] Request payload summary:", {
      hand,
      handKey,
      currentHandNum,
      communityCardsState: communityCardsPayload.state,
      communityCards: communityCardsPayload.cards,
      staleCommunitySnapshot,
      availableActions: getAvailableActions(),
    });

    try {
      const res = await fetch(`${BACKEND_URL}/api/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          hand: getHand(),
          pot_size: getPotSize(),
          stack_size: getStackSize(),
          num_players: getNumPlayers(),
          game_type: gameInfo.game_type,
          big_blind: gameInfo.big_blind,
          small_blind: gameInfo.small_blind,
          available_actions: getAvailableActions(),
          hand_num: currentHandNum,
          community_cards: communityCardsPayload.cards,
          community_cards_state: communityCardsPayload.state,
        }),
      });
      clearTimeout(timeoutId);
      return await res.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        console.error("[PokerBot] Backend request timed out.");
      } else {
        console.error("[PokerBot] Failed to get action:", err);
      }
      return null;
    }
  }

  async function notifyHandStart() {
    const gameInfo = getGameInfo();
    if (!gameInfo) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      await fetch(`${BACKEND_URL}/api/hand-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          num_players: getNumPlayers(),
          game_type: gameInfo.game_type,
          big_blind: gameInfo.big_blind,
          small_blind: gameInfo.small_blind,
        }),
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("[PokerBot] Failed to notify hand start:", err);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function notifyHandEnd() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      await fetch(`${BACKEND_URL}/api/hand-end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          stack_size: getStackSize(),
        }),
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("[PokerBot] Failed to notify hand end:", err);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── Overlay UI ────────────────────────────────────────────────

  function createOverlay() {
    statusOverlay = document.createElement("div");
    statusOverlay.id = "poker-bot-overlay";
    statusOverlay.innerHTML = `
      <div class="poker-bot-header">
        <span class="poker-bot-title">🤖 PokerBot</span>
        <span class="poker-bot-status-dot"></span>
      </div>
      <div class="poker-bot-status-text">Disabled</div>
      <div class="poker-bot-suggestion" id="poker-bot-suggestion" style="display:none;"></div>
      <div class="poker-bot-buttons" id="poker-bot-buttons" style="display:none;">
        <button class="poker-bot-btn suggest-btn" id="poker-bot-suggest">💡 Suggest</button>
        <button class="poker-bot-btn autoplay-btn" id="poker-bot-autoplay">⚡ Auto-play</button>
      </div>
      <button class="poker-bot-btn auto-toggle-btn" id="poker-bot-auto-toggle">🔄 Full Auto: OFF</button>
    `;
    document.body.appendChild(statusOverlay);

    // Wire up button clicks
    document
      .getElementById("poker-bot-suggest")
      .addEventListener("click", onSuggestClick);
    document
      .getElementById("poker-bot-autoplay")
      .addEventListener("click", onAutoplayClick);
    document
      .getElementById("poker-bot-auto-toggle")
      .addEventListener("click", onAutoToggleClick);
  }

  function updateStatus(text) {
    if (!statusOverlay) return;
    const statusText = statusOverlay.querySelector(".poker-bot-status-text");
    const dot = statusOverlay.querySelector(".poker-bot-status-dot");
    if (statusText) statusText.textContent = text;
    if (dot) {
      dot.className = "poker-bot-status-dot " + (enabled ? "active" : "");
    }
  }

  function showSuggestion(action, amount) {
    const el = document.getElementById("poker-bot-suggestion");
    if (!el) return;
    let text = action.toUpperCase();
    if (
      amount &&
      amount > 0 &&
      !["check", "fold", "call"].includes(action.toLowerCase())
    ) {
      text += ` ${amount}`;
    }
    el.textContent = `→ ${text}`;
    el.style.display = "block";
  }

  function hideSuggestion() {
    const el = document.getElementById("poker-bot-suggestion");
    if (el) {
      el.textContent = "";
      el.style.display = "none";
    }
  }

  function showButtons() {
    const el = document.getElementById("poker-bot-buttons");
    if (el) el.style.display = "flex";
  }

  function hideButtons() {
    const el = document.getElementById("poker-bot-buttons");
    if (el) el.style.display = "none";
  }

  function setButtonsLoading(loading) {
    const suggestBtn = document.getElementById("poker-bot-suggest");
    const autoplayBtn = document.getElementById("poker-bot-autoplay");
    if (suggestBtn) suggestBtn.disabled = loading;
    if (autoplayBtn) autoplayBtn.disabled = loading;
    if (loading) {
      if (suggestBtn) suggestBtn.textContent = "⏳ Thinking...";
    } else {
      if (suggestBtn) suggestBtn.textContent = "💡 Suggest";
    }
  }

  // ─── Toast Notification ─────────────────────────────────────────

  function showToast(message, durationMs = 3000) {
    const existing = document.getElementById("poker-bot-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "poker-bot-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger reflow then add visible class for animation
    requestAnimationFrame(() => toast.classList.add("visible"));

    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 300);
    }, durationMs);
  }

  async function checkConfigVersion() {
    if (!enabled) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/health`, { method: "GET" });
      const data = await res.json();
      if (data.config_version !== undefined) {
        if (
          lastConfigVersion !== null &&
          data.config_version !== lastConfigVersion
        ) {
          showToast("✅ Strategy prompt updated");
        }
        lastConfigVersion = data.config_version;
      }
    } catch (e) {
      // backend not reachable, ignore
    }
  }

  // ─── Button Handlers ──────────────────────────────────────────

  async function fetchSuggestion() {
    setButtonsLoading(true);
    updateStatus("Querying AI...");

    try {
      let response = null;
      for (let attempt = 0; attempt < SUGGEST_RETRY_ATTEMPTS; attempt++) {
        response = await requestAction();
        if (!(response && response.status === "retry")) {
          break;
        }

        const retryDelay =
          Number(response.retry_after_ms) || SUGGEST_RETRY_DELAY;
        console.log(
          `[PokerBot] Suggest retry ${attempt + 1}/${SUGGEST_RETRY_ATTEMPTS}: ${response.reason || "server requested retry"} (waiting ${retryDelay}ms)`,
        );
        updateStatus("Syncing hand state...");
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }

      if (response && response.action) {
        cachedSuggestion = { action: response.action, amount: response.amount };
        showSuggestion(response.action, response.amount);
        updateStatus("Suggestion ready");
      } else {
        updateStatus("AI returned no action");
        cachedSuggestion = null;
      }
    } catch (err) {
      console.error("[PokerBot] Suggest error:", err);
      updateStatus("Error getting suggestion");
      cachedSuggestion = null;
    }

    setButtonsLoading(false);
    return cachedSuggestion;
  }

  async function onSuggestClick() {
    if (processing) return;
    processing = true;
    processingStartTime = Date.now();
    try {
      cachedSuggestion = null;
      hideSuggestion();
      await fetchSuggestion();
    } catch (err) {
      console.error("[PokerBot] Suggest click error:", err);
    } finally {
      processing = false;
    }
  }

  async function onAutoplayClick() {
    if (processing) return;
    processing = true;
    processingStartTime = Date.now();
    try {
      // If no suggestion yet, fetch one first
      if (!cachedSuggestion) {
        hideSuggestion();
        await fetchSuggestion();
      }

      if (cachedSuggestion) {
        updateStatus(`Executing: ${cachedSuggestion.action}`);
        const success = await executeAction(
          cachedSuggestion.action,
          cachedSuggestion.amount,
        );
        if (success) {
          updateStatus(`Played: ${cachedSuggestion.action}`);
        } else {
          console.warn("[PokerBot] Failed to execute, trying check/fold.");
          if (!clickCheck()) clickFold();
          updateStatus("Fallback: check/fold");
        }
        cachedSuggestion = null;
        hideSuggestion();
        hideButtons();
      } else {
        updateStatus("No suggestion available");
      }
    } catch (err) {
      console.error("[PokerBot] Autoplay click error:", err);
    } finally {
      processing = false;
    }
  }

  function onAutoToggleClick() {
    autoMode = !autoMode;
    const btn = document.getElementById("poker-bot-auto-toggle");
    if (btn) {
      btn.textContent = autoMode ? "🔄 Full Auto: ON" : "🔄 Full Auto: OFF";
      btn.classList.toggle("auto-on", autoMode);
    }
    if (autoMode) {
      showToast("Full auto enabled — bot will play automatically");
      updateStatus("Full auto ON");
      // Reset so the level-triggered check in mainLoop can fire
      autoPlayedThisTurn = false;
    } else {
      // Bump generation so any in-flight auto operation becomes stale
      autoGeneration++;
      // Always release the processing lock when switching to manual mode.
      // Without this, an in-flight auto request keeps processing=true and
      // button clicks silently fail until the request completes.
      processing = false;
      showToast("Full auto disabled — manual mode");
      // If it's currently our turn, show manual buttons immediately
      if (isMyTurn()) {
        cachedSuggestion = null;
        hideSuggestion();
        showButtons();
        setButtonsLoading(false);
        updateStatus("Your turn — choose an action");
      } else {
        updateStatus("Active — waiting for hand...");
      }
    }
  }

  // ─── Auto-Play Logic (extracted for reuse) ─────────────────────

  async function triggerAutoPlay() {
    if (processing) return;
    processing = true;
    processingStartTime = Date.now();
    const myGen = autoGeneration; // snapshot to detect stale operations
    const myTurnGen = turnGeneration; // snapshot to detect manual actions
    updateStatus("Auto: thinking...");
    hideButtons();
    try {
      const response = await requestAction();
      // Abort if autoMode was toggled off while we were waiting
      if (!autoMode || autoGeneration !== myGen) {
        console.log("[PokerBot] Auto operation aborted (mode changed).");
        return;
      }
      // Abort if the turn changed (user acted manually, new turn started)
      if (turnGeneration !== myTurnGen) {
        console.log(
          "[PokerBot] Auto operation aborted (turn changed — manual action detected). Will rethink.",
        );
        autoPlayedThisTurn = false; // allow re-trigger on the new turn
        return;
      }
      if (response && response.action) {
        updateStatus(`Auto: ${response.action}`);
        const success = await executeAction(response.action, response.amount);
        // Check again after execution delay
        if (!autoMode || autoGeneration !== myGen) {
          return;
        }
        if (success) {
          updateStatus(`Auto played: ${response.action}`);
        } else {
          if (!clickCheck()) clickFold();
          updateStatus("Auto fallback: check/fold");
        }
      } else {
        if (!autoMode || autoGeneration !== myGen) {
          return;
        }
        if (!clickCheck()) clickFold();
        updateStatus("Auto: no response, check/fold");
      }
      autoPlayedThisTurn = true;
    } catch (err) {
      console.error("[PokerBot] Auto error:", err);
      if (autoMode && autoGeneration === myGen) {
        if (!clickCheck()) clickFold();
        updateStatus("Auto error: check/fold");
      }
    } finally {
      processing = false;
    }
  }

  // ─── Overlay Health Check ──────────────────────────────────────

  function ensureOverlay() {
    if (!document.getElementById("poker-bot-overlay")) {
      console.warn("[PokerBot] Overlay was removed from DOM — re-creating.");
      createOverlay();
      if (enabled) {
        updateStatus(
          autoMode ? "Full auto ON" : "Active — waiting for hand...",
        );
      } else {
        updateStatus("Disabled — configure in popup");
      }
    }
  }

  // ─── Main Loop ─────────────────────────────────────────────────

  let lastWasWaiting = false;
  let lastWasWinner = false;
  let lastWasMyTurn = false;

  async function mainLoop() {
    if (!enabled) return;
    if (mainLoopRunning) return;
    mainLoopRunning = true;
    try {
      // Ensure overlay is still in the DOM (host page may remove it)
      ensureOverlay();

      // Safety: reset processing if it has been stuck too long
      if (
        processing &&
        processingStartTime > 0 &&
        Date.now() - processingStartTime > PROCESSING_TIMEOUT
      ) {
        console.warn(
          "[PokerBot] Processing was stuck for too long, force-resetting.",
        );
        processing = false;
        processingStartTime = 0;
        updateStatus("Reset — was stuck");
      }

      // Detect new hand (transition from waiting to not-waiting)
      const waiting = isWaiting();
      if (lastWasWaiting && !waiting) {
        console.log("[PokerBot] New hand detected.");
        currentHandNum = (currentHandNum || 0) + 1;
        await notifyHandStart();
        updateStatus("Hand in progress...");
      }
      lastWasWaiting = waiting;

      // Detect hand end (winner appears)
      const winner = isWinner();
      if (winner && !lastWasWinner) {
        console.log("[PokerBot] Winner detected, hand ending.");
        await notifyHandEnd();
        updateStatus("Hand ended. Waiting...");
        cachedSuggestion = null;
        hideSuggestion();
        hideButtons();
      }
      lastWasWinner = winner;

      if (waiting) {
        updateStatus("Waiting for next hand...");
        hideButtons();
        hideSuggestion();
        return;
      }

      // Detect turn start/end
      const myTurn = isMyTurn();
      if (myTurn && !lastWasMyTurn) {
        // Turn just started
        console.log("[PokerBot] Your turn.");
        turnGeneration++;
        cachedSuggestion = null;
        hideSuggestion();
        autoPlayedThisTurn = false;

        if (!autoMode) {
          // Manual mode: show buttons
          showButtons();
          setButtonsLoading(false);
          updateStatus("Your turn — choose an action");
        }
      } else if (!myTurn && lastWasMyTurn) {
        // Turn ended
        hideButtons();
        hideSuggestion();
        cachedSuggestion = null;
        autoPlayedThisTurn = false;
        if (autoMode) {
          updateStatus("Full auto ON — waiting...");
        } else {
          updateStatus("Hand in progress...");
        }
      }

      // Level-triggered auto-play: fires every poll while it's our turn.
      // Unlike edge-triggered, this ensures auto-play fires even if the
      // exact transition poll was missed (e.g. processing was true).
      if (myTurn && autoMode && !processing && !autoPlayedThisTurn) {
        triggerAutoPlay();
      }

      lastWasMyTurn = myTurn;
    } finally {
      mainLoopRunning = false;
    }
  }

  // ─── Message Listener (from popup) ─────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SET_CONFIG") {
      botName = msg.botName || "";
      enabled = msg.enabled || false;

      if (enabled && botName && !initialized) {
        sendInit().then((ok) => {
          if (ok) {
            updateStatus("Active — waiting for hand...");
          } else {
            updateStatus("Failed to connect to backend");
          }
          sendResponse({ status: ok ? "ok" : "error" });
        });
        return true; // async response
      }

      if (!enabled) {
        updateStatus("Disabled");
        hideButtons();
        hideSuggestion();
      } else {
        updateStatus("Active — waiting for hand...");
      }
      sendResponse({ status: "ok" });
    }

    if (msg.type === "GET_STATUS") {
      sendResponse({
        enabled: enabled,
        botName: botName,
        initialized: initialized,
        gameId: getGameId(),
        gameInfo: getGameInfo(),
      });
    }
  });

  // ─── Initialize ────────────────────────────────────────────────

  function start() {
    console.log("[PokerBot] Content script loaded on PokerNow page.");
    createOverlay();
    updateStatus("Disabled — configure in popup");

    // Start polling
    setInterval(mainLoop, POLL_INTERVAL);

    // Poll for config changes every 5 seconds
    setInterval(checkConfigVersion, 5000);
  }

  if (document.readyState === "complete") {
    start();
  } else {
    window.addEventListener("load", start);
  }
})();
