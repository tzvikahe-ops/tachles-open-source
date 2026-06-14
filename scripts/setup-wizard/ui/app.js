const params = new URLSearchParams(window.location.search);
const token = params.get("session") || "";

if (token) {
  window.history.replaceState({}, "", window.location.pathname);
}

const statusElement = document.querySelector("#status");
const startButton = document.querySelector("#start-button");

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

async function initialize() {
  if (!token) {
    statusElement.textContent = "קישור ההפעלה אינו תקין. הפעילו מחדש את קובץ ההתקנה.";
    statusElement.dataset.state = "error";
    return;
  }

  try {
    const session = await request("/api/session");
    if (session.status !== "ready") {
      throw new Error("Unexpected session state");
    }

    statusElement.textContent = "השרת המקומי מוכן. אפשר להתחיל.";
    statusElement.dataset.state = "ready";
    startButton.disabled = false;
  } catch {
    statusElement.textContent = "לא הצלחנו להתחבר לשרת המקומי. הפעילו מחדש את האשף.";
    statusElement.dataset.state = "error";
  }
}

startButton.addEventListener("click", () => {
  statusElement.textContent = "התשתית מוכנה. במסך הבא תתווסף בחירת סוג ההתקנה.";
  startButton.textContent = "מוכן";
  startButton.disabled = true;
});

initialize();
