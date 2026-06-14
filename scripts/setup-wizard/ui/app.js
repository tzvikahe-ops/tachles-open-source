const params = new URLSearchParams(window.location.search);
const incomingToken = params.get("session") || "";

if (incomingToken) {
  window.sessionStorage.setItem("tachlesSetupToken", incomingToken);
  window.history.replaceState({}, "", window.location.pathname);
}

const token = window.sessionStorage.getItem("tachlesSetupToken") || "";
const statusElement = document.querySelector("#status");
const startButton = document.querySelector("#start-button");
const welcomeScreen = document.querySelector("#welcome-screen");
const modeScreen = document.querySelector("#mode-screen");
const modeButtons = document.querySelectorAll("[data-mode]");
const progressElement = document.querySelector("#progress");
const modeEyebrow = document.querySelector("#mode-eyebrow");
const modeTitle = document.querySelector("#mode-title");
const modeIntro = document.querySelector("#mode-intro");
const actionPanel = document.querySelector("#action-panel");
const runCheckButton = document.querySelector("#run-check");
const cancelCheckButton = document.querySelector("#cancel-check");
const technicalLog = document.querySelector("#technical-log");
let actionPoll = null;

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...options.headers,
      "X-Tachles-Setup-Token": token,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function renderState(state) {
  const activeStep = Number(state.activeStep || 1);
  welcomeScreen.hidden = activeStep !== 1;
  modeScreen.hidden = activeStep !== 2;
  progressElement.textContent = `Windows · שלב ${activeStep} מתוך 8`;

  modeButtons.forEach((button) => {
    button.dataset.selected = button.dataset.mode === state.installMode ? "true" : "false";
  });

  if (activeStep > 2) {
    modeScreen.hidden = false;
    actionPanel.hidden = false;
    modeEyebrow.textContent = "שלב 3 מתוך 8";
    modeTitle.textContent = "הבחירה נשמרה";
    modeIntro.textContent = "בשלב הבא נבדוק אילו כלי פיתוח כבר מותקנים במחשב.";
    statusElement.textContent = "הבחירה נשמרה. השלב הבא יהיה בדיקת כלי הפיתוח במחשב.";
    statusElement.dataset.state = "ready";
    modeButtons.forEach((button) => {
      button.disabled = true;
    });
  }
}

async function loadLog() {
  const log = await request("/api/log");
  technicalLog.textContent = log.content || "עוד אין פלט להצגה.";
}

async function pollAction() {
  try {
    const action = await request("/api/action");
    if (action.status === "running") {
      statusElement.textContent = "הבדיקה המקומית פועלת...";
      runCheckButton.disabled = true;
      cancelCheckButton.hidden = false;
      return;
    }

    if (actionPoll) {
      window.clearInterval(actionPoll);
    }
    actionPoll = null;
    runCheckButton.disabled = false;
    cancelCheckButton.hidden = true;
    await loadLog();
    if (action.status === "idle") {
      statusElement.textContent = "הבחירה נשמרה. אפשר להפעיל את הבדיקה המקומית.";
      statusElement.dataset.state = "ready";
      return;
    }
    statusElement.textContent = action.status === "succeeded"
      ? "הבדיקה המקומית הושלמה בהצלחה."
      : action.message === "cancelled"
      ? "הבדיקה בוטלה."
      : "הבדיקה המקומית נכשלה.";
    statusElement.dataset.state = action.status === "succeeded" ? "ready" : "error";
  } catch {
    window.clearInterval(actionPoll);
    actionPoll = null;
    statusElement.textContent = "לא הצלחנו לקרוא את מצב הבדיקה.";
    statusElement.dataset.state = "error";
  }
}

async function initialize() {
  if (!token) {
    statusElement.textContent = "קישור ההפעלה אינו תקין. הפעילו מחדש את קובץ ההתקנה.";
    statusElement.dataset.state = "error";
    return;
  }

  try {
    const [session, state] = await Promise.all([
      request("/api/session"),
      request("/api/state"),
    ]);
    if (session.status !== "ready") {
      throw new Error("Unexpected session state");
    }

    renderState(state);
    statusElement.textContent = state.activeStep === 1
      ? "השרת המקומי מוכן. אפשר להתחיל."
      : "ההתקדמות הקודמת נטענה בהצלחה.";
    statusElement.dataset.state = "ready";
    startButton.disabled = false;
    if (Number(state.activeStep || 1) > 2) {
      await pollAction();
    }
  } catch {
    statusElement.textContent = "לא הצלחנו להתחבר לשרת המקומי. הפעילו מחדש את האשף.";
    statusElement.dataset.state = "error";
  }
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  try {
    const state = await request("/api/state", {
      method: "POST",
      body: JSON.stringify({ activeStep: 2 }),
    });
    renderState(state);
    statusElement.textContent = "בחרו את סוג ההתקנה שמתאים לכם.";
  } catch {
    statusElement.textContent = "לא הצלחנו לשמור את ההתקדמות. נסו שוב.";
    statusElement.dataset.state = "error";
    startButton.disabled = false;
  }
});

modeButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    modeButtons.forEach((item) => {
      item.disabled = true;
    });
    try {
      const state = await request("/api/state", {
        method: "POST",
        body: JSON.stringify({
          activeStep: 3,
          installMode: button.dataset.mode,
        }),
      });
      renderState(state);
    } catch {
      statusElement.textContent = "לא הצלחנו לשמור את הבחירה. נסו שוב.";
      statusElement.dataset.state = "error";
      modeButtons.forEach((item) => {
        item.disabled = false;
      });
    }
  });
});

runCheckButton.addEventListener("click", async () => {
  runCheckButton.disabled = true;
  statusElement.dataset.state = "ready";
  try {
    await request("/api/action/local_check", { method: "POST" });
    cancelCheckButton.hidden = false;
    actionPoll = window.setInterval(pollAction, 300);
    await pollAction();
  } catch {
    runCheckButton.disabled = false;
    statusElement.textContent = "לא הצלחנו להפעיל את הבדיקה המקומית.";
    statusElement.dataset.state = "error";
  }
});

cancelCheckButton.addEventListener("click", async () => {
  cancelCheckButton.disabled = true;
  try {
    await request("/api/action/cancel", { method: "POST" });
    await pollAction();
  } finally {
    cancelCheckButton.disabled = false;
  }
});

initialize();
