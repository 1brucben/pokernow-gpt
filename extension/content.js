// PokerNow GPT Bot - Content Script
// Runs on pokernow.com/games/* pages

(function () {
  "use strict";

  const BACKEND_URL = "http://localhost:3000";
  const POLL_INTERVAL = 500; // ms between DOM checks
  const ACTION_DELAY = 800; // ms delay before executing action
  const BET_TYPE_DELAY = 150; // ms delay between keystrokes when typing bet

  let enabled = false;
  let botName = "";
  let processing = false;
  let currentHandNum = null;
  let initialized = false;
  let statusOverlay = null;

  // Cached suggestion for current turn
  let cachedSuggestion = null; // { action, amount }
  let turnActive = false;

  // Config version tracking (for toast notifications)
  let lastConfigVersion = null;

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

    try {
      const res = await fetch(`${BACKEND_URL}/api/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hand: getHand(),
          pot_size: getPotSize(),
          stack_size: getStackSize(),
          num_players: getNumPlayers(),
          game_type: gameInfo.game_type,
          big_blind: gameInfo.big_blind,
          small_blind: gameInfo.small_blind,
          available_actions: getAvailableActions(),
        }),
      });
      return await res.json();
    } catch (err) {
      console.error("[PokerBot] Failed to get action:", err);
      return null;
    }
  }

  async function notifyHandStart() {
    const gameInfo = getGameInfo();
    if (!gameInfo) return;

    try {
      await fetch(`${BACKEND_URL}/api/hand-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          num_players: getNumPlayers(),
          game_type: gameInfo.game_type,
          big_blind: gameInfo.big_blind,
          small_blind: gameInfo.small_blind,
        }),
      });
    } catch (err) {
      console.error("[PokerBot] Failed to notify hand start:", err);
    }
  }

  async function notifyHandEnd() {
    try {
      await fetch(`${BACKEND_URL}/api/hand-end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stack_size: getStackSize(),
        }),
      });
    } catch (err) {
      console.error("[PokerBot] Failed to notify hand end:", err);
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
    `;
    document.body.appendChild(statusOverlay);

    // Wire up button clicks
    document
      .getElementById("poker-bot-suggest")
      .addEventListener("click", onSuggestClick);
    document
      .getElementById("poker-bot-autoplay")
      .addEventListener("click", onAutoplayClick);
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
      const response = await requestAction();
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
    cachedSuggestion = null;
    hideSuggestion();
    await fetchSuggestion();
    processing = false;
  }

  async function onAutoplayClick() {
    if (processing) return;
    processing = true;

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

    processing = false;
  }

  // ─── Main Loop ─────────────────────────────────────────────────

  let lastWasWaiting = false;
  let lastWasWinner = false;
  let lastWasMyTurn = false;

  async function mainLoop() {
    if (!enabled) return;

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
      // Turn just started — show buttons
      console.log("[PokerBot] Your turn — showing controls.");
      cachedSuggestion = null;
      hideSuggestion();
      showButtons();
      setButtonsLoading(false);
      updateStatus("Your turn — choose an action");
    } else if (!myTurn && lastWasMyTurn) {
      // Turn ended
      hideButtons();
      hideSuggestion();
      cachedSuggestion = null;
      updateStatus("Hand in progress...");
    }
    lastWasMyTurn = myTurn;
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
