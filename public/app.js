const modeSelect = document.querySelector("#modeSelect");
const modelSelect = document.querySelector("#modelSelect");
const reasoningToggle = document.querySelector("#reasoningToggle");
const statusEl = document.querySelector("#status");
const messagesEl = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const promptInput = document.querySelector("#promptInput");
const sendButton = document.querySelector("#sendButton");
const evaluationMetricsEl = document.querySelector("#evaluationMetrics");
const auditPreviewEl = document.querySelector("#auditPreview");

const FALLBACK_MODES = {
  khmer: {
    label: "Khmer loan explanation",
    model: "gemma4:e4b-it-q4_K_M",
    placeholder: "Ask about loan, data warehouse, KPI, or reports...",
    welcome: "Khmer mode is locked to gemma4:e4b-it-q4_K_M and uses BANKING_DWH_DB metadata.",
  },
  sql: {
    label: "SQL for loan warehouse",
    model: "qwen2.5-coder:3b",
    placeholder: "Ask for a DWH SQL query, KPI logic, or dashboard validation...",
    welcome: "SQL mode is locked to qwen2.5-coder:3b and only targets BANKING_DWH_DB.",
  },
};

let assistantConfig = { modes: FALLBACK_MODES, dwhDb: "BANKING_DWH_DB" };
let conversation = [];

function removeThaiText(text) {
  return String(text || "").replace(/[\u0E00-\u0E7F]+/g, "");
}

function currentModeKey() {
  return assistantConfig.modes[modeSelect.value] ? modeSelect.value : "khmer";
}

function currentMode() {
  return assistantConfig.modes[currentModeKey()] || FALLBACK_MODES.khmer;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function formatPercent(metric, invert = false) {
  if (!metric || !Number.isFinite(metric.score)) {
    return "N/A";
  }

  const score = invert ? 1 - metric.score : metric.score;
  return `${Math.round(score * 100)}%`;
}

function metricText(label, metric, invert = false) {
  const count = metric?.count ? ` (${metric.count})` : "";
  return `${label}: ${formatPercent(metric, invert)}${count}`;
}

function renderEvaluationSummary(summary) {
  const metrics = summary.metrics || {};
  evaluationMetricsEl.textContent = [
    metricText("SQL correctness", metrics.sqlCorrectness),
    metricText("Answer accuracy", metrics.answerAccuracy),
    metricText("Hallucination-free", metrics.hallucinationRate, true),
    metricText("Usefulness", metrics.responseUsefulness),
    metricText("Guardrail success", metrics.guardrailSuccessRate),
  ].join(" | ");

  const feedback = summary.feedback || {};
  const latestAudit = summary.recentAudit?.[0];
  const feedbackText = `Feedback: ${feedback.correctAnswer || 0} correct, ${feedback.wrongAnswer || 0} wrong, ${feedback.unclearAnswer || 0} unclear`;

  if (!latestAudit) {
    auditPreviewEl.textContent = `${feedbackText}. Audit log: waiting for activity.`;
    return;
  }

  const blockedText = latestAudit.blockedQueryReason ? ` Blocked: ${latestAudit.blockedQueryReason}` : "";
  auditPreviewEl.textContent = [
    feedbackText,
    `Latest audit: ${latestAudit.executionStatus || "unknown"} in ${latestAudit.responseTimeMs || 0} ms.`,
    blockedText.trim(),
  ].filter(Boolean).join(" ");
}

async function loadEvaluationSummary() {
  try {
    const response = await fetch("/api/evaluation/summary");
    const summary = await response.json();
    if (!response.ok) {
      throw new Error(summary.error || "Could not load evaluation summary.");
    }
    renderEvaluationSummary(summary);
  } catch (error) {
    evaluationMetricsEl.textContent = "Evaluation summary unavailable.";
    auditPreviewEl.textContent = error.message;
  }
}

function renderSuggestionButtons(container, suggestions) {
  container.innerHTML = "";

  suggestions.forEach((suggestion) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-chip";
    button.textContent = removeThaiText(suggestion);
    button.addEventListener("click", () => {
      if (sendButton.disabled) return;
      promptInput.value = removeThaiText(suggestion);
      resizeInput();
      sendMessage(removeThaiText(suggestion));
    });
    container.appendChild(button);
  });
}

async function loadLlmSuggestions(modeKey, container) {
  container.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "suggestion-loading";
  loading.textContent = "Asking the SQL model for fresh ideas...";
  container.appendChild(loading);

  try {
    const response = await fetch(`/api/suggestions?mode=${encodeURIComponent(modeKey)}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.detail || "Suggestion generation failed.");
    }

    if (currentModeKey() !== modeKey || !document.body.contains(container)) return;

    if (!data.suggestions?.length) {
      container.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "suggestion-loading";
      empty.textContent = "No model suggestions returned.";
      container.appendChild(empty);
      return;
    }

    renderSuggestionButtons(container, data.suggestions);
  } catch (error) {
    if (currentModeKey() !== modeKey || !document.body.contains(container)) return;

    container.innerHTML = "";
    const failed = document.createElement("div");
    failed.className = "suggestion-loading error";
    failed.textContent = `${error.message} Make sure Ollama is running.`;
    container.appendChild(failed);
  }
}

function showEmptyState() {
  messagesEl.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const modeKey = currentModeKey();

  const intro = document.createElement("p");
  intro.textContent = currentMode().welcome || `${currentMode().label} uses ${currentMode().model}.`;
  empty.appendChild(intro);

  if (modeKey === "sql") {
    const suggestionTitle = document.createElement("p");
    suggestionTitle.className = "suggestion-title";
    suggestionTitle.textContent = "SQL ideas from the model:";
    empty.appendChild(suggestionTitle);

    const suggestionGrid = document.createElement("div");
    suggestionGrid.className = "suggestion-grid";
    empty.appendChild(suggestionGrid);
    loadLlmSuggestions(modeKey, suggestionGrid);
  }

  messagesEl.appendChild(empty);
}

function removeEmptyState() {
  const empty = messagesEl.querySelector(".empty-state");
  if (empty) empty.remove();
}

function addMessage(role, content = "") {
  removeEmptyState();
  const message = document.createElement("div");
  message.className = `message ${role}`;
  message.textContent = removeThaiText(content);
  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return message;
}

async function readStreamedText(response, onChunk) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    text += removeThaiText(decoder.decode(value, { stream: true }));
    onChunk(removeThaiText(text));
  }

  return removeThaiText(text);
}

async function requestChatText({ requestType, messages }, onChunk) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: currentModeKey(),
      requestType,
      messages,
    }),
  });

  if (!response.ok || !response.body) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Chat request failed.");
  }

  const text = await readStreamedText(response, onChunk);
  return {
    text,
    auditId: response.headers.get("X-Audit-Id") || "",
  };
}

function resizeInput() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${promptInput.scrollHeight}px`;
}

function setLockedModel() {
  const mode = currentMode();
  modelSelect.innerHTML = "";
  const option = document.createElement("option");
  option.value = mode.model;
  option.textContent = mode.model;
  modelSelect.appendChild(option);
}

function resetConversation() {
  const mode = currentMode();
  conversation = [];
  promptInput.placeholder = mode.placeholder || "Ask your banking DWH assistant...";
  setLockedModel();
  showEmptyState();
  setStatus(`Ready. ${mode.label} with ${mode.model}. DWH only: ${assistantConfig.dwhDb}.`);
}

async function loadConfig() {
  try {
    const [configResponse, modelsResponse] = await Promise.all([
      fetch("/api/config"),
      fetch("/api/models"),
    ]);
    const config = await configResponse.json();
    const modelStatus = await modelsResponse.json();

    if (!configResponse.ok) {
      throw new Error(config.error || "Could not load assistant config.");
    }
    if (!modelsResponse.ok) {
      throw new Error(modelStatus.error || "Could not check Ollama models.");
    }

    assistantConfig = {
      ...config,
      modes: {
        khmer: { ...FALLBACK_MODES.khmer, ...config.modes.khmer },
        sql: { ...FALLBACK_MODES.sql, ...config.modes.sql },
      },
    };

    resetConversation();
    loadEvaluationSummary();

    if (modelStatus.missingModels?.length) {
      setStatus(`Missing Ollama model: ${modelStatus.missingModels.join(", ")}`, true);
    }
  } catch (error) {
    setStatus(`${error.message} Start Ollama, then refresh this page.`, true);
    resetConversation();
    loadEvaluationSummary();
  }
}

function extractSqlBlock(text) {
  const match = text.match(/```sql\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : "";
}

function formatRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return "No rows returned.";
  }

  return JSON.stringify(rows, null, 2);
}

function addSqlRunner(container, sql, question, auditId) {
  const action = document.createElement("button");
  action.type = "button";
  action.className = "query-action";
  action.textContent = "Run SELECT on BANKING_DWH_DB";

  action.addEventListener("click", async () => {
    action.disabled = true;
    const resultBubble = addMessage("sql-result", "Running safe SELECT on BANKING_DWH_DB...");

    try {
      const response = await fetch("/api/sql/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, question, auditId }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.detail || "SQL query failed.");
      }

      const warningText = data.warnings?.length ? `\nWarnings: ${data.warnings.join(" ")}` : "";
      resultBubble.textContent = [
        `SQL result from ${data.dwhDb}`,
        `Rows: ${data.rowCount}`,
        warningText.trim(),
        formatRows(data.rows),
      ].filter(Boolean).join("\n\n");
    } catch (error) {
      resultBubble.textContent = `SQL blocked or failed: ${error.message}`;
    } finally {
      action.disabled = false;
      loadEvaluationSummary();
    }
  });

  container.appendChild(document.createElement("br"));
  container.appendChild(action);
}

async function submitFeedback(bar, interaction, rating, selectedButton) {
  const buttons = [...bar.querySelectorAll("button")];
  const status = bar.querySelector(".feedback-status");
  buttons.forEach((button) => {
    button.classList.remove("is-selected");
  });
  selectedButton.classList.add("is-selected");
  bar.classList.add("is-saving");
  buttons.forEach((button) => {
    button.disabled = true;
  });
  status.textContent = "Saving...";

  try {
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auditId: interaction.auditId,
        mode: interaction.mode,
        question: interaction.question,
        answer: interaction.answer,
        generatedSql: interaction.generatedSql,
        rating,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Feedback was not saved.");
    }
    bar.classList.remove("is-saving");
    bar.classList.add("is-saved");
    status.textContent = "Thanks";
    loadEvaluationSummary();
  } catch (error) {
    bar.classList.remove("is-saving");
    selectedButton.classList.remove("is-selected");
    status.textContent = error.message;
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function getFeedbackIcon(rating) {
  if (rating === "correct_answer") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 10v11"></path>
        <path d="M15 5.4 14 10h5.1a2 2 0 0 1 1.9 2.6l-2 6.4a2 2 0 0 1-1.9 1.4H5a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2h2.4a2 2 0 0 0 1.8-1.1L12.2 3a2.3 2.3 0 0 1 2.8 2.4Z"></path>
      </svg>
    `;
  }

  if (rating === "wrong_answer") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17 14V3"></path>
        <path d="M9 18.6 10 14H4.9A2 2 0 0 1 3 11.4L5 5a2 2 0 0 1 1.9-1.4H19a2 2 0 0 1 2 2V12a2 2 0 0 1-2 2h-2.4a2 2 0 0 0-1.8 1.1L11.8 21A2.3 2.3 0 0 1 9 18.6Z"></path>
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M9.2 9a3 3 0 0 1 5.6 1.5c0 1.8-2.8 2.3-2.8 4"></path>
      <path d="M12 18h.01"></path>
    </svg>
  `;
}

function addFeedbackControls(container, interaction) {
  const bar = document.createElement("div");
  bar.className = "feedback-bar";
  bar.setAttribute("aria-label", "Answer feedback");

  [
    ["correct_answer", "Correct answer", "Helpful"],
    ["wrong_answer", "Wrong answer", "Not helpful"],
    ["unclear_answer", "Unclear answer", "Unclear"],
  ].forEach(([rating, labelText, tooltip]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "feedback-button";
    button.setAttribute("aria-label", labelText);
    button.title = tooltip;
    button.innerHTML = getFeedbackIcon(rating);
    button.addEventListener("click", () => submitFeedback(bar, interaction, rating, button));
    bar.appendChild(button);
  });

  const status = document.createElement("span");
  status.className = "feedback-status";
  status.setAttribute("aria-live", "polite");
  bar.appendChild(status);

  container.appendChild(bar);
}

async function sendMessage(prompt) {
  conversation.push({ role: "user", content: prompt });
  addMessage("user", prompt);

  const thinkingBubble = reasoningToggle.checked ? addMessage("thinking", "Thinking summary\n- Preparing...") : null;
  const assistantBubble = addMessage("assistant", reasoningToggle.checked ? "Answer\n" : "");
  sendButton.disabled = true;
  promptInput.disabled = true;
  setStatus(`Thinking with ${currentMode().model}...`);

  try {
    if (reasoningToggle.checked) {
      await requestChatText(
        {
          requestType: "thinking",
          messages: [{ role: "user", content: prompt }],
        },
        (text) => {
          thinkingBubble.textContent = text;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        },
      );
    }

    let assistantText = "";
    const answerResult = await requestChatText(
      {
        requestType: "answer",
        messages: conversation,
      },
      (text) => {
        assistantText = text;
        assistantBubble.textContent = reasoningToggle.checked ? `Answer\n${text}` : text;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      },
    );
    assistantText = answerResult.text;

    conversation.push({ role: "assistant", content: assistantText });

    const sql = currentModeKey() === "sql" ? extractSqlBlock(assistantText) : "";
    const interaction = {
      auditId: answerResult.auditId,
      mode: currentModeKey(),
      question: prompt,
      answer: assistantText,
      generatedSql: sql ? [sql] : [],
    };

    if (sql) {
      addSqlRunner(assistantBubble, sql, prompt, answerResult.auditId);
    }
    addFeedbackControls(assistantBubble, interaction);
    loadEvaluationSummary();

    setStatus(`Ready. Using ${currentMode().model}.`);
  } catch (error) {
    assistantBubble.textContent = `Error: ${error.message}`;
    setStatus(error.message, true);
    conversation.pop();
  } finally {
    sendButton.disabled = false;
    promptInput.disabled = false;
    promptInput.focus();
  }
}

promptInput.addEventListener("input", resizeInput);
modeSelect.addEventListener("change", resetConversation);
reasoningToggle.addEventListener("change", resetConversation);
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = removeThaiText(promptInput.value.trim());
  if (!prompt) return;

  promptInput.value = "";
  resizeInput();
  await sendMessage(prompt);
});

showEmptyState();
loadConfig();
