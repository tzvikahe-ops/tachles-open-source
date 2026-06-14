const params = new URLSearchParams(window.location.search);
const incomingToken = params.get("session") || "";
if (incomingToken) {
  window.sessionStorage.setItem("tachlesSetupToken", incomingToken);
  window.history.replaceState({}, "", window.location.pathname);
}

const token = window.sessionStorage.getItem("tachlesSetupToken") || "";
const stepNames = [
  "פתיחה",
  "מסלול",
  "הכנת המחשב",
  "Supabase",
  "Vercel",
  "AI ו־Push",
  "Google",
  "בדיקות וסיום",
];
const stepKeys = [
  "welcome",
  "mode",
  "prerequisites",
  "supabase",
  "vercel",
  "capabilities",
  "google",
  "verification",
];

const statusElement = document.querySelector("#status");
const logElement = document.querySelector("#technical-log");
const backButton = document.querySelector("#back-button");
const progressLabel = document.querySelector("#progress-label");
const mobileStep = document.querySelector("#mobile-step");
const mobileStepName = document.querySelector("#mobile-step-name");
const stepList = document.querySelector("#step-list");
let setupState = null;
let actionTimer = null;

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      "X-Tachles-Setup-Token": token,
    },
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return value;
}

function setStatus(text, state = "ready") {
  statusElement.textContent = text;
  statusElement.dataset.state = state;
}

async function loadLog() {
  const log = await request("/api/log");
  logElement.textContent = log.content || "עוד אין פלט להצגה.";
}

async function saveState(changes) {
  setupState = await request("/api/state", {
    method: "POST",
    body: JSON.stringify(changes),
  });
  renderState();
  return setupState;
}

async function completeAndMove(step, nextStep) {
  await saveState({
    activeStep: nextStep,
    stepStatus: { step, status: "succeeded" },
  });
  await loadStepData(nextStep);
}

function renderStepNav() {
  const highestCompleted = stepKeys.reduce(
    (highest, key, index) =>
      setupState.steps[key] === "succeeded" ? Math.max(highest, index + 1) : highest,
    0,
  );
  const maxAllowed = Math.max(Number(setupState.activeStep), highestCompleted + 1);
  stepList.innerHTML = stepNames.map((name, index) => {
    const step = index + 1;
    const status = setupState.steps[stepKeys[index]];
    const marker = status === "succeeded" ? "✓" : String(step);
    return `
      <li>
        <button type="button" data-jump="${step}" data-status="${status}"
          ${step > maxAllowed ? "disabled" : ""}
          ${step === setupState.activeStep ? 'aria-current="step"' : ""}>
          <span>${marker}</span><span>${name}</span>
        </button>
      </li>
    `;
  }).join("");
}

function renderState() {
  const activeStep = Number(setupState.activeStep || 1);
  document.querySelectorAll(".step-screen").forEach((screen) => {
    screen.hidden = Number(screen.dataset.step) !== activeStep;
  });
  renderStepNav();
  progressLabel.textContent = `שלב ${activeStep} מתוך 8`;
  mobileStep.textContent = `שלב ${activeStep} מתוך 8`;
  mobileStepName.textContent = stepNames[activeStep - 1];
  backButton.hidden = activeStep === 1;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.dataset.selected = button.dataset.mode === setupState.installMode ? "true" : "false";
  });
  document.querySelectorAll(".full-only").forEach((element) => {
    element.hidden = setupState.installMode === "basic";
  });
}

async function loadConfigIntoForms() {
  const [config, secrets] = await Promise.all([
    request("/api/config"),
    request("/api/secrets"),
  ]);
  document.querySelectorAll("form input[name]").forEach((input) => {
    if (input.type !== "password" && Object.hasOwn(config, input.name)) {
      input.value = input.name === "VAPID_SUBJECT"
        ? (config[input.name] || "").replace(/^mailto:/, "")
        : config[input.name] || "";
    }
    if (input.type === "password" && secrets[input.name]) {
      input.placeholder = "כבר נשמר";
    }
  });
}

async function loadPrerequisites() {
  const list = document.querySelector("#tool-list");
  list.innerHTML = '<p class="loading">בודק את המחשב...</p>';
  const result = await request("/api/prerequisites");
  list.innerHTML = result.items.map((tool) => `
    <div class="tool-row">
      <div>
        <strong>${tool.label}</strong>
        <small>${
    tool.version
      ? `גרסה ${tool.version}`
      : tool.hint === "npx"
      ? "מופעל לפי הצורך דרך npx"
      : `נדרשת גרסה ${tool.minimum} ומעלה`
  }</small>
      </div>
      ${
    tool.ready
      ? '<span class="state-pill ready">מוכן</span>'
      : tool.installable
      ? `<button class="secondary install-tool" data-tool="${tool.id}" type="button">התקנה</button>`
      : `<span class="state-pill">${
        tool.hint === "npx" ? "מופעל דרך npx" : "נדרשת התקנה ידנית"
      }</span>`
  }
    </div>
  `).join("");
  document.querySelector("#tools-next").disabled = !result.ready;
  setStatus(
    result.ready
      ? "כל כלי הפיתוח מוכנים."
      : result.winget
      ? "יש כלים שחסרים. אפשר להתקין אותם אחד־אחד."
      : "Winget אינו זמין. התקינו את הכלים החסרים מהאתרים הרשמיים.",
    result.ready ? "ready" : "error",
  );
}

async function loadGoogle() {
  const guidance = await request("/api/google");
  const items = [
    {
      title: "הפעילו את Calendar API",
      link: guidance.calendarApiUrl,
    },
    {
      title: "הפעילו את Drive API",
      link: guidance.driveApiUrl,
    },
    {
      title: "הגדירו Audience מסוג External",
      link: guidance.consentUrl,
    },
    {
      title: "צרו OAuth Web Client והוסיפו את שתי הכתובות",
      link: guidance.cloudConsoleUrl,
      values: [guidance.authRedirect, guidance.integrationRedirect].filter(Boolean),
    },
  ];
  document.querySelector("#google-guidance").innerHTML = items.map((item, index) => `
    <div class="guidance-item">
      <span class="number">${index + 1}</span>
      <div>
        <strong>${item.title}</strong>
        <div><a href="${item.link}" target="_blank" rel="noreferrer">פתיחת המסך המתאים</a></div>
        ${
    (item.values || []).map((value) => `
          <div class="copy-row">
            <code>${value}</code>
            <button class="text-button copy-value" data-value="${value}" type="button">העתקה</button>
          </div>
        `).join("")
  }
      </div>
    </div>
  `).join("");
}

async function loadVercelStatus() {
  const value = await request("/api/vercel");
  const box = document.querySelector("#vercel-result");
  const authNote = document.querySelector("#auth-url-note");
  box.hidden = !value.configured;
  authNote.hidden = !value.configured;
  if (value.configured) {
    box.innerHTML =
      `כתובת האפליקציה: <a href="${value.url}" target="_blank" rel="noreferrer">${value.url}</a>`;
    const config = await request("/api/config");
    if (config.SUPABASE_PROJECT_REF) {
      document.querySelector("#auth-settings-link").href =
        `https://supabase.com/dashboard/project/${config.SUPABASE_PROJECT_REF}/auth/url-configuration`;
    }
  }
}

async function loadStepData(step) {
  await loadLog();
  if (step >= 4) {
    await loadConfigIntoForms();
  }
  if (step === 3) await loadPrerequisites();
  if (step === 5) await loadVercelStatus();
  if (step === 7) await loadGoogle();
  if (step === 6) {
    const supabase = await request("/api/supabase");
    const vaultAction = document.querySelector("#vault-action");
    vaultAction.hidden = !supabase.vaultFileReady;
    if (supabase.projectRef) {
      document.querySelector("#sql-editor-link").href =
        `https://supabase.com/dashboard/project/${supabase.projectRef}/sql/new`;
    }
  }
  if (step === 7) {
    const config = await request("/api/config");
    if (config.SUPABASE_PROJECT_REF) {
      document.querySelector("#supabase-provider-link").href =
        `https://supabase.com/dashboard/project/${config.SUPABASE_PROJECT_REF}/auth/providers`;
    }
  }
}

async function pollAction(onSuccess) {
  const action = await request("/api/action");
  await loadLog();
  if (action.status === "running") return;
  window.clearInterval(actionTimer);
  actionTimer = null;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = false;
  });
  if (action.status === "succeeded") {
    setStatus("הפעולה הושלמה בהצלחה.");
    await onSuccess();
  } else {
    setStatus(
      action.message === "cancelled" ? "הפעולה בוטלה." : "הפעולה נכשלה. פרטים ביומן הטכני.",
      "error",
    );
  }
}

async function runAction(name, runningText, onSuccess) {
  if (actionTimer) return;
  setStatus(runningText);
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  try {
    await request(`/api/action/${name}`, { method: "POST" });
    actionTimer = window.setInterval(() => {
      pollAction(onSuccess).catch(() => {
        setStatus("לא הצלחנו לקרוא את מצב הפעולה.", "error");
      });
    }, 700);
  } catch {
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = false;
    });
    setStatus("לא הצלחנו להפעיל את הפעולה.", "error");
  }
}

async function saveSecret(name, value) {
  if (!value) return;
  await request("/api/secret", {
    method: "POST",
    body: JSON.stringify({ name, value }),
  });
}

document.addEventListener("click", async (event) => {
  const next = event.target.closest("[data-next]");
  if (next) {
    const changes = { activeStep: Number(next.dataset.next) };
    if (Number(setupState.activeStep) === 1) {
      changes.stepStatus = { step: "welcome", status: "succeeded" };
    }
    await saveState(changes);
    await loadStepData(Number(next.dataset.next));
    return;
  }

  const jump = event.target.closest("[data-jump]");
  if (jump) {
    await saveState({ activeStep: Number(jump.dataset.jump) });
    await loadStepData(Number(jump.dataset.jump));
    return;
  }

  const mode = event.target.closest("[data-mode]");
  if (mode) {
    await saveState({
      activeStep: 3,
      installMode: mode.dataset.mode,
      stepStatus: { step: "mode", status: "succeeded" },
    });
    await loadPrerequisites();
    return;
  }

  const installer = event.target.closest(".install-tool");
  if (installer) {
    await runAction(
      `install_${installer.dataset.tool}`,
      "מתקין את הכלי. ייתכן שיופיע חלון הרשאה של Windows...",
      loadPrerequisites,
    );
    return;
  }

  const copy = event.target.closest(".copy-value");
  if (copy) {
    await navigator.clipboard.writeText(copy.dataset.value);
    setStatus("הכתובת הועתקה.");
  }
});

backButton.addEventListener("click", async () => {
  const nextStep = Math.max(1, Number(setupState.activeStep) - 1);
  await saveState({ activeStep: nextStep });
  await loadStepData(nextStep);
});

document.querySelector("#refresh-tools").addEventListener("click", loadPrerequisites);
document.querySelector("#tools-next").addEventListener(
  "click",
  () => completeAndMove("prerequisites", 4),
);

document.querySelector("#supabase-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  await request("/api/config", {
    method: "POST",
    body: JSON.stringify({
      SUPABASE_PROJECT_REF: data.get("SUPABASE_PROJECT_REF"),
      VITE_SUPABASE_PUBLISHABLE_KEY: data.get("VITE_SUPABASE_PUBLISHABLE_KEY"),
    }),
  });
  await saveSecret("SUPABASE_DB_PASSWORD", data.get("SUPABASE_DB_PASSWORD"));
  await runAction(
    "prepare_supabase",
    "מקשר את הפרויקט ומחיל את מבנה מסד הנתונים...",
    async () => {
      document.querySelector("#vault-note").hidden = false;
      await completeAndMove("supabase", 5);
    },
  );
});

document.querySelector("#deploy-vercel").addEventListener("click", () => {
  runAction(
    "deploy_vercel",
    "בונה ומפרסם את אפליקציית ה־PWA...",
    async () => {
      await loadVercelStatus();
      setStatus("האפליקציה פורסמה. הגדירו את כתובת הכניסה ב־Supabase.");
    },
  );
});

document.querySelector("#auth-url-done").addEventListener(
  "click",
  () => completeAndMove("vercel", 6),
);

document.querySelector("#capabilities-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  await saveSecret("ANTHROPIC_API_KEY", data.get("ANTHROPIC_API_KEY"));
  await saveSecret("OPENAI_API_KEY", data.get("OPENAI_API_KEY"));
  await request("/api/config", {
    method: "POST",
    body: JSON.stringify({
      VAPID_SUBJECT: `mailto:${String(data.get("VAPID_SUBJECT")).replace(/^mailto:/, "")}`,
      WEB_ALLOWED_EMAILS: data.get("WEB_ALLOWED_EMAILS"),
    }),
  });
  const generateAndDeploy = async () => {
    await runAction(
      "generate_secrets",
      "יוצר מפתחות מקומיים מאובטחים...",
      async () => {
        await runAction(
          "deploy_supabase",
          "מעלה סודות ופורס את שירותי ה־Backend...",
          async () => {
            await loadStepData(6);
            document.querySelector("#vault-action").hidden = false;
            setStatus("ה־Backend מוכן. נותר להריץ את קובץ Vault.");
          },
        );
      },
    );
  };
  if (setupState.installMode === "full") {
    await runAction(
      "validate_ai",
      "בודק את מפתחות ה־AI...",
      generateAndDeploy,
    );
  } else {
    await generateAndDeploy();
  }
});

document.querySelector("#vault-done").addEventListener(
  "click",
  () => completeAndMove("capabilities", 7),
);

document.querySelector("#google-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const clientId = data.get("GOOGLE_CLIENT_ID");
  const clientSecret = data.get("GOOGLE_CLIENT_SECRET");
  if (clientId && clientSecret) {
    await saveSecret("GOOGLE_CLIENT_ID", clientId);
    await saveSecret("GOOGLE_CLIENT_SECRET", clientSecret);
    const guidance = await request("/api/google");
    await request("/api/config", {
      method: "POST",
      body: JSON.stringify({ OAUTH_REDIRECT_URI: guidance.integrationRedirect }),
    });
  }
  if (clientId && clientSecret) {
    await runAction(
      "deploy_google",
      "מעלה את הגדרות Google ופורס מחדש את החיבור...",
      () => completeAndMove("google", 8),
    );
  } else {
    await completeAndMove("google", 8);
  }
});

document.querySelector("#skip-google").addEventListener(
  "click",
  () => completeAndMove("google", 8),
);

document.querySelector("#run-verification").addEventListener("click", async () => {
  setStatus("בודק את הפריסה...");
  const report = await request("/api/verification");
  const list = document.querySelector("#verification-list");
  list.innerHTML = report.checks.length
    ? report.checks.map((check) => `
      <div class="verification-item">
        <div>
          <strong>${
      check.name === "pwa"
        ? "אפליקציית PWA"
        : check.name === "auth-settings"
        ? "Supabase Auth"
        : "הגנת API"
    }</strong>
          <small>${check.url}</small>
        </div>
        <span class="state-pill ${check.ready ? "ready" : ""}">
          ${check.ready ? "עבר" : `נכשל (${check.status || "אין חיבור"})`}
        </span>
      </div>
    `).join("")
    : '<p class="loading">חסרים פרטי פריסה לביצוע הבדיקה.</p>';
  if (report.ready) {
    await saveState({
      stepStatus: { step: "verification", status: "succeeded" },
    });
    const panel = document.querySelector("#finish-panel");
    panel.hidden = false;
    const activeCapabilities = [
      "משימות, זיכרונות ותזכורות",
      report.capabilities.push ? "Push" : null,
      report.capabilities.ai ? "AI וקול" : null,
      report.capabilities.google ? "Google Calendar ו־Drive" : null,
    ].filter(Boolean);
    panel.querySelector("p").textContent = `פעיל: ${
      activeCapabilities.join(", ")
    }. אפשר להתקין את האפליקציה למסך הבית.`;
    document.querySelector("#finish-links").innerHTML = `
      <a class="external-link" href="${report.webAppUrl}" target="_blank" rel="noreferrer">פתיחת תכלס</a>
      <a class="text-button" href="${report.supabaseDashboard}" target="_blank" rel="noreferrer">Supabase</a>
      <a class="text-button" href="${report.vercelDashboard}" target="_blank" rel="noreferrer">Vercel</a>
    `;
    setStatus("ההתקנה הושלמה והבדיקות עברו.");
  } else {
    setStatus("חלק מהבדיקות נכשלו. בדקו את הפרטים ונסו שוב.", "error");
  }
});

async function initialize() {
  if (!token) {
    setStatus("קישור ההפעלה אינו תקין. הפעילו מחדש את קובץ ההתקנה.", "error");
    return;
  }
  try {
    const session = await request("/api/session");
    if (session.status !== "ready") throw new Error("Invalid session");
    setupState = await request("/api/state");
    renderState();
    await loadStepData(Number(setupState.activeStep));
    setStatus("האשף מוכן. אפשר להמשיך מהשלב שבו עצרתם.");
  } catch {
    setStatus("לא הצלחנו להתחבר לשרת המקומי. הפעילו מחדש את האשף.", "error");
  }
}

initialize();
