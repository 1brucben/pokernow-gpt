const BACKEND_URL = "http://localhost:3000";

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const botNameInput = document.getElementById("botName");
const statusText = document.getElementById("statusText");
const gameInfoText = document.getElementById("gameInfo");
const backendStatusText = document.getElementById("backendStatus");

// Check backend health
async function checkBackend() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { method: "GET" });
    if (res.ok) {
      backendStatusText.textContent = "Connected";
      backendStatusText.className = "value connected";
      return true;
    }
  } catch (e) {
    // ignore
  }
  backendStatusText.textContent = "Not running";
  backendStatusText.className = "value disconnected";
  return false;
}

// Get status from content script
function getContentStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "GET_STATUS" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        statusText.textContent = "Not on a PokerNow page";
        gameInfoText.textContent = "—";
        startBtn.disabled = true;
        return;
      }
      startBtn.disabled = false;

      if (response.enabled) {
        statusText.textContent = "Running";
        statusText.className = "value connected";
        botNameInput.value = response.botName || "";
        startBtn.style.display = "none";
        stopBtn.style.display = "block";
      } else {
        statusText.textContent = "Stopped";
      }

      if (response.gameInfo) {
        const gi = response.gameInfo;
        gameInfoText.textContent = `${gi.game_type} ${gi.small_blind}/${gi.big_blind}`;
      } else {
        gameInfoText.textContent = "Waiting for game...";
      }
    });
  });
}

// Load saved name
chrome.storage.local.get(["botName"], (result) => {
  if (result.botName) {
    botNameInput.value = result.botName;
  }
});

startBtn.addEventListener("click", () => {
  const name = botNameInput.value.trim();
  if (!name) {
    statusText.textContent = "Enter your player name first";
    statusText.className = "value disconnected";
    return;
  }

  chrome.storage.local.set({ botName: name });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(
      tabs[0].id,
      { type: "SET_CONFIG", botName: name, enabled: true },
      (response) => {
        if (chrome.runtime.lastError) {
          statusText.textContent = "Failed - not on PokerNow page";
          statusText.className = "value disconnected";
          return;
        }
        if (response && response.status === "ok") {
          statusText.textContent = "Running";
          statusText.className = "value connected";
          startBtn.style.display = "none";
          stopBtn.style.display = "block";
        } else {
          statusText.textContent = "Failed to connect to backend";
          statusText.className = "value disconnected";
        }
      },
    );
  });
});

stopBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(
      tabs[0].id,
      { type: "SET_CONFIG", botName: "", enabled: false },
      () => {
        statusText.textContent = "Stopped";
        statusText.className = "value";
        startBtn.style.display = "block";
        stopBtn.style.display = "none";
      },
    );
  });
});

// Init
checkBackend();
getContentStatus();
