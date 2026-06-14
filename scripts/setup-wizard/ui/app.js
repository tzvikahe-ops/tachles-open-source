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

initialize();
