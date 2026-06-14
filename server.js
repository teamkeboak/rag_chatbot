const http = require("http");
const fs = require("fs");
const path = require("path");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const PUBLIC_DIR = path.join(__dirname, "public");
const METADATA_DIR = path.join(__dirname, "metadata");
const LOG_DIR = path.join(__dirname, "logs");
const CHAT_LOG_FILE = "chat_queries.jsonl";
const QUERY_AUDIT_LOG_FILE = "query_audit.jsonl";
const FEEDBACK_LOG_FILE = "human_feedback.jsonl";
const MAX_SUMMARY_EVENTS = 5000;

const SOURCE_DB = process.env.SOURCE_DB || "FLEXCUBE_SOURCE_DB";
const STAGING_DB = process.env.STAGING_DB || "BANKING_STAGING_DB";
const DWH_DB = process.env.DWH_DB || "BANKING_DWH_DB";
const SQL_SERVER = process.env.SQL_SERVER || "DESKTOP-7OP1RCB";
const SQL_DRIVER = process.env.SQL_DRIVER || "ODBC Driver 17 for SQL Server";
const SQL_TRUSTED_CONNECTION = /^(yes|true|1)$/i.test(process.env.SQL_TRUSTED_CONNECTION || "yes");
const SQL_TRUST_SERVER_CERTIFICATE = !/^(no|false|0)$/i.test(process.env.SQL_TRUST_SERVER_CERTIFICATE || "yes");
const SQL_QUERY_TIMEOUT_MS = Number(process.env.SQL_QUERY_TIMEOUT_MS || 15000);

const MODES = {
  khmer: {
    label: "Khmer loan explanation",
    model: "gemma4:e4b-it-q4_K_M",
    temperature: 0.25,
    answerTokens: 2200,
    // Context window must fit the full system prompt (~5k tokens of metadata +
    // rules) PLUS the conversation PLUS the generated answer. Ollama defaults to
    // 2048, which silently truncates the grounding and causes generic/hallucinated
    // answers. 8192 comfortably covers prompt + answerTokens.
    numCtx: 8192,
    languageRule: "Answer mainly in Khmer. Use English only for SQL keywords, table names, column names, and technical terms that are clearer in English.",
  },
  sql: {
    label: "SQL for loan warehouse",
    model: "qwen2.5-coder:3b",
    temperature: 0.05,
    answerTokens: 1800,
    numCtx: 8192,
    languageRule: "Answer in clear English unless the user asks for Khmer. Generate T-SQL for Microsoft SQL Server.",
  },
};

const APPROVED_VIEWS = [
  "VW_LOAN_PORTFOLIO_DAILY",
  "VW_DAILY_KPI_SUMMARY",
  "VW_MONTHLY_KPI_SUMMARY",
  "VW_DQ_RUN_SUMMARY",
  "VW_DQ_RESULT_DETAIL",
  "VW_LOAN_ANOMALY_BASE",
  "VW_PIPELINE_RUN_MONITORING",
];

const WAREHOUSE_TABLES = [
  "DIM_DATE",
  "DIM_CUSTOMER",
  "DIM_BRANCH",
  "DIM_PRODUCT",
  "DIM_CURRENCY",
  "DIM_LOAN_STATUS",
  "DIM_COLLECTION_OFFICER",
  "DIM_LOAN_ACCOUNT",
  "FACT_LOAN_PORTFOLIO_DAILY",
  "DQ_RULE",
  "DQ_RESULT",
  "DQ_RUN_SUMMARY",
  "DQ_BATCH_PROFILE",
  "ANOMALY_RESULT",
  "PIPELINE_RUN_LOG",
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

let sqlPoolPromise;

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const splitAt = trimmed.indexOf("=");
    if (splitAt === -1) continue;

    const key = trimmed.slice(0, splitAt).trim();
    const value = trimmed.slice(splitAt + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function removeThaiText(text) {
  return String(text || "").replace(/[\u0E00-\u0E7F]+/g, "");
}

function readMetadataFile(name) {
  const filePath = path.join(METADATA_DIR, name);
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8").trim();
}

function getMetadataContext() {
  return [
    readMetadataFile("database_policy.md"),
    readMetadataFile("warehouse_schema.md"),
    readMetadataFile("kpi_glossary.md"),
    readMetadataFile("business_rules.md"),
    readMetadataFile("approved_sql_examples.md"),
  ].filter(Boolean).join("\n\n");
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function extractJsonObject(text) {
  const cleaned = String(text || "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (_error) {
    const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch (_fencedError) {
        return null;
      }
    }

    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;

    try {
      return JSON.parse(objectMatch[0]);
    } catch (_objectError) {
      return null;
    }
  }
}

function normalizeSuggestionsFromText(text) {
  const parsed = extractJsonObject(text);
  const parsedSuggestions = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.suggestions)
      ? parsed.suggestions
      : [];

  const suggestions = parsedSuggestions
    .map((suggestion) => removeThaiText(String(suggestion || "")).replace(/\s+/g, " ").trim())
    .filter((suggestion) => suggestion.length >= 20 && suggestion.length <= 220)
    .slice(0, 6);

  if (suggestions.length) return suggestions;

  return String(text || "")
    .split(/\r?\n/)
    .map((line) => removeThaiText(line).replace(/^[-*\d.)\s]+/, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 20 && line.length <= 220)
    .slice(0, 6);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url);
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
    });
    res.end(data);
  });
}

function getMode(modeName) {
  return MODES[modeName] ? modeName : "khmer";
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: removeThaiText(String(message.content || "")).slice(0, 12000),
    }))
    .filter((message) => message.content.trim())
    .slice(-12);
}

function getLastUserMessage(messages) {
  const last = [...messages].reverse().find((message) => message.role === "user");
  return last ? last.content : "";
}

function createAuditId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function hasThaiScript(text) {
  return /[\u0E00-\u0E7F]/.test(String(text || ""));
}

function buildSystemPrompt(modeName, requestType) {
  const mode = MODES[modeName];
  const sqlHelpRule = modeName === "sql" && requestType !== "thinking"
    ? [
        "SQL mode answer style:",
        "If the user asks generally what you can do, what you can query, asks for ideas, says hi, or gives a broad analytics topic, do not answer with only a clarification question.",
        "Instead, give 5 to 7 concrete loan analytics or DWH reporting options with short descriptions.",
        "Mention the likely approved view or warehouse table for each option when known.",
        "End by asking which option the user wants you to generate SQL for.",
        "If the user asks for a specific query, generate the SQL directly.",
      ].join(" ")
    : "";
  const visibleThinkingRule = requestType === "thinking"
    ? [
        "Return only a visible thinking summary, not the final answer.",
        "Use the title 'Thinking summary'.",
        "Use 2 to 4 short bullets.",
        "Summarize assumptions, DWH objects, KPI logic, SQL safety checks, or validation risks.",
        "Do not reveal hidden chain-of-thought, private scratch work, or long internal reasoning.",
      ].join(" ")
    : [
        "Answer directly with enough detail to be useful.",
        "For Khmer explanations, do not stop mid-section; if the topic is broad, organize the answer into clear numbered sections.",
        "If writing SQL, include one fenced ```sql code block.",
      ].join(" ");

  return [
    "You are a local banking data warehouse assistant for loan analytics.",
    mode.languageRule,
    "Never use Thai language or Thai script. If Thai text appears in source data or user input, summarize it in Khmer or English without copying Thai script.",
    `You know these databases exist: ${SOURCE_DB} is raw source, ${STAGING_DB} is copied staging, and ${DWH_DB} is the clean data warehouse.`,
    `Only use ${DWH_DB}. Never query, reference, join, or suggest access to ${SOURCE_DB} or ${STAGING_DB}.`,
    "Prefer approved Power BI views over raw tables when possible.",
    `Approved views: ${APPROVED_VIEWS.join(", ")}.`,
    `Known warehouse tables: ${WAREHOUSE_TABLES.join(", ")}.`,
    "Safe SQL rules: SELECT only. Block INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, EXEC, MERGE, CREATE, USE, source database access, and staging database access.",
    "Use TOP 100 when a query has no explicit limit. Use date filters when answering daily portfolio questions.",
    "Do not invent exact column names if the question requires schema details that are not provided. State assumptions briefly.",
    sqlHelpRule,
    visibleThinkingRule,
    "Metadata, KPI glossary, schema relationships, business rules, and approved SQL examples follow:",
    getMetadataContext(),
    "Final output must not contain Thai script characters.",
  ].join("\n");
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function appendJsonLine(fileName, event) {
  ensureLogDir();
  const logPath = path.join(LOG_DIR, fileName);
  fs.appendFile(
    logPath,
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`,
    () => {},
  );
}

function logEvent(event) {
  appendJsonLine(CHAT_LOG_FILE, event);
}

function logAuditEvent(event) {
  appendJsonLine(QUERY_AUDIT_LOG_FILE, event);
}

function logFeedbackEvent(event) {
  appendJsonLine(FEEDBACK_LOG_FILE, event);
}

function readJsonLines(fileName) {
  const filePath = path.join(LOG_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];

  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-MAX_SUMMARY_EVENTS);
}

function clampScore(score) {
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(1, score));
}

function averageScores(items, getScore) {
  const scores = items
    .map(getScore)
    .filter((score) => Number.isFinite(score));

  if (scores.length === 0) {
    return { score: null, count: 0 };
  }

  return {
    score: scores.reduce((total, score) => total + score, 0) / scores.length,
    count: scores.length,
  };
}

function extractSqlBlocks(text) {
  const blocks = [];
  const regex = /```sql\s*([\s\S]*?)```/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");
}

function normalizeSql(sql) {
  return String(sql || "").trim().replace(/;+\s*$/g, "");
}

function validateReadOnlyDwhSql(sql) {
  let normalized = normalizeSql(sql);
  const withoutComments = stripSqlComments(normalized);
  const compact = withoutComments.replace(/\s+/g, " ").trim();
  const upper = compact.toUpperCase();
  const forbiddenTokens = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "ALTER",
    "TRUNCATE",
    "EXEC",
    "EXECUTE",
    "MERGE",
    "CREATE",
    "GRANT",
    "REVOKE",
    "BACKUP",
    "RESTORE",
    "USE",
  ];

  if (!/^(SELECT|WITH)\b/i.test(compact)) {
    return { ok: false, error: "Only SELECT queries are allowed." };
  }

  if (compact.includes(";")) {
    return { ok: false, error: "Only one SQL statement is allowed." };
  }

  for (const token of forbiddenTokens) {
    if (new RegExp(`\\b${token}\\b`, "i").test(compact)) {
      return { ok: false, error: `${token} is blocked. Only SELECT is allowed.` };
    }
  }

  if (upper.includes(SOURCE_DB.toUpperCase()) || upper.includes(STAGING_DB.toUpperCase())) {
    return { ok: false, error: "Source and staging database access is blocked." };
  }

  const databaseReferencePattern = /(?:\[?([A-Z0-9_]+)\]?\s*\.\s*\[?[A-Z0-9_]+\]?\s*\.\s*\[?[A-Z0-9_]+\]?)/gi;
  let match;
  while ((match = databaseReferencePattern.exec(compact)) !== null) {
    const dbName = match[1].replace(/[\[\]]/g, "").toUpperCase();
    if (dbName !== DWH_DB.toUpperCase()) {
      return { ok: false, error: `Database ${dbName} is blocked. Use ${DWH_DB} only.` };
    }
  }

  if (!/\b(TOP|FETCH\s+NEXT|OFFSET|LIMIT)\b/i.test(compact)) {
    if (/^SELECT\s+/i.test(normalized)) {
      normalized = normalized.replace(/^SELECT\s+(DISTINCT\s+)?/i, (_match, distinct = "") => `SELECT ${distinct}TOP 100 `);
    } else {
      return { ok: false, error: "CTE queries must include TOP 100, FETCH, OFFSET, or another explicit limit." };
    }
  }

  const referencesApprovedView = APPROVED_VIEWS.some((view) => upper.includes(view));
  return {
    ok: true,
    sql: normalized,
    warnings: referencesApprovedView ? [] : ["Query does not reference an approved view. Prefer approved views when possible."],
  };
}

function normalizeObjectName(name) {
  const cleaned = String(name || "")
    .replace(/[\[\]]/g, "")
    .replace(/["'`]/g, "")
    .trim();
  const parts = cleaned.split(".").map((part) => part.trim()).filter(Boolean);
  return (parts[parts.length - 1] || cleaned).toUpperCase();
}

function getKnownDwhObjects() {
  return new Set([...APPROVED_VIEWS, ...WAREHOUSE_TABLES].map(normalizeObjectName));
}

function stripSqlStrings(sql) {
  return String(sql || "").replace(/N?'(?:''|[^'])*'/gi, "''");
}

function extractReferencedObjectsFromSql(sql) {
  const objects = new Set();
  const cleaned = stripSqlStrings(stripSqlComments(sql));
  const objectPattern = /\b(?:FROM|JOIN|APPLY)\s+([#@]?\[?[A-Z0-9_]+\]?(?:\.\[?[A-Z0-9_]+\]?){0,2})/gi;
  let match;

  while ((match = objectPattern.exec(cleaned)) !== null) {
    const objectName = normalizeObjectName(match[1]);
    if (objectName && !objectName.startsWith("#") && !objectName.startsWith("@")) {
      objects.add(objectName);
    }
  }

  return [...objects];
}

function extractLikelyDwhObjects(text) {
  const objects = new Set();
  const objectPattern = /\b(?:VW|DIM|FACT|DQ|ANOMALY|PIPELINE)_[A-Z0-9_]+\b/gi;
  let match;

  while ((match = objectPattern.exec(String(text || ""))) !== null) {
    objects.add(normalizeObjectName(match[0]));
  }

  return [...objects];
}

function looksLikeSqlRequest(question) {
  return /\b(sql|query|select|table|view|report|dashboard|portfolio|par|npl|outstanding|disbursement|repayment|count|sum|list|show|find|compare|group by)\b/i.test(String(question || ""));
}

function evaluateHallucination(responseText, sqlBlocks) {
  const knownObjects = getKnownDwhObjects();
  const mentionedObjects = new Set(extractLikelyDwhObjects(responseText));

  for (const block of sqlBlocks) {
    for (const objectName of extractReferencedObjectsFromSql(block.sql)) {
      mentionedObjects.add(objectName);
    }
  }

  const unknownObjects = [...mentionedObjects].filter((objectName) => !knownObjects.has(objectName));
  const totalObjects = mentionedObjects.size;

  return {
    rate: totalObjects === 0 ? 0 : unknownObjects.length / totalObjects,
    suspectedObjects: unknownObjects,
    checkedObjects: totalObjects,
    basis: "DWH object names compared with configured approved views and warehouse tables.",
  };
}

function evaluateSqlCorrectness(modeName, question, sqlBlocks) {
  const requestedSql = modeName === "sql" && looksLikeSqlRequest(question);

  if (sqlBlocks.length === 0) {
    return {
      score: requestedSql ? 0 : null,
      applicable: requestedSql,
      generatedCount: 0,
      validCount: 0,
      basis: requestedSql ? "The user likely asked for SQL but no SQL block was generated." : "No SQL was requested or generated.",
    };
  }

  const blockScores = sqlBlocks.map((block) => {
    if (!block.validation.ok) return 0;
    return block.validation.warnings?.length ? 0.85 : 1;
  });
  const validCount = sqlBlocks.filter((block) => block.validation.ok).length;

  return {
    score: clampScore(blockScores.reduce((total, score) => total + score, 0) / blockScores.length),
    applicable: true,
    generatedCount: sqlBlocks.length,
    validCount,
    basis: "Generated SQL was checked with the read-only DWH validator.",
  };
}

function evaluateAnswerAccuracy(responseText, sqlCorrectness, hallucinationRate) {
  const trimmed = String(responseText || "").trim();
  if (!trimmed) {
    return {
      score: 0,
      confidence: "low",
      needsHumanReview: true,
      basis: "Empty answer.",
    };
  }

  let score = 0.76;
  if (/error:|failed|could not/i.test(trimmed)) score -= 0.3;
  if (hasThaiScript(trimmed)) score -= 0.25;
  if (Number.isFinite(sqlCorrectness.score)) score += (sqlCorrectness.score - 0.75) * 0.35;
  score -= Math.min(0.45, hallucinationRate.rate * 0.8);
  if (/\b(assum|not provided|not enough|cannot determine|verify)\b/i.test(trimmed)) score += 0.05;

  return {
    score: clampScore(score),
    confidence: "low",
    needsHumanReview: true,
    basis: "Heuristic only. Human feedback should be used as the source of truth for answer correctness.",
  };
}

function evaluateResponseUsefulness(modeName, question, responseText, sqlBlocks, sqlCorrectness) {
  const trimmed = String(responseText || "").trim();
  if (!trimmed) {
    return { score: 0, basis: "Empty answer." };
  }

  const requestedSql = modeName === "sql" && looksLikeSqlRequest(question);
  let score = 0.45;

  if (trimmed.length >= 80) score += 0.15;
  if (trimmed.length >= 240) score += 0.1;
  if (requestedSql && sqlBlocks.length > 0) score += 0.25;
  if (!requestedSql && /\b(example|steps|summary|because|recommend|use)\b/i.test(trimmed)) score += 0.12;
  if (Number.isFinite(sqlCorrectness.score) && sqlCorrectness.score < 0.5) score -= 0.25;
  if (/error:|failed|could not/i.test(trimmed)) score -= 0.2;

  return {
    score: clampScore(score),
    basis: "Heuristic from response length, request fit, SQL presence, and validation quality.",
  };
}

function evaluateGuardrail(responseText, sqlBlocks, executionStatus, blockedQueryReason) {
  const invalidSqlCount = sqlBlocks.filter((block) => !block.validation.ok).length;
  const thaiScriptPresent = hasThaiScript(responseText);
  const blocked = executionStatus === "blocked" || Boolean(blockedQueryReason);
  const applicable = sqlBlocks.length > 0 || blocked || thaiScriptPresent;

  return {
    applicable,
    success: applicable ? !thaiScriptPresent && (invalidSqlCount === 0 || Boolean(blockedQueryReason) || executionStatus === "sql_validation_failed") : null,
    invalidSqlCount,
    thaiScriptPresent,
    blockedQueryReason: blockedQueryReason || "",
    basis: "Thai-script filtering, SQL validation, and blocked-query handling.",
  };
}

function evaluateChatInteraction({ modeName, question, responseText, sqlBlocks, executionStatus, blockedQueryReason }) {
  const hallucinationRate = evaluateHallucination(responseText, sqlBlocks);
  const sqlCorrectness = evaluateSqlCorrectness(modeName, question, sqlBlocks);
  const answerAccuracy = evaluateAnswerAccuracy(responseText, sqlCorrectness, hallucinationRate);
  const responseUsefulness = evaluateResponseUsefulness(modeName, question, responseText, sqlBlocks, sqlCorrectness);
  const guardrail = evaluateGuardrail(responseText, sqlBlocks, executionStatus, blockedQueryReason);

  return {
    sqlCorrectness,
    answerAccuracy,
    hallucinationRate,
    responseUsefulness,
    guardrail,
  };
}

function summarizeSqlBlocks(sqlBlocks) {
  return sqlBlocks.map((block) => ({
    sql: block.validation.ok ? block.validation.sql : block.sql,
    validation: block.validation,
  }));
}

async function handleConfig(_req, res) {
  sendJson(res, 200, {
    dwhDb: DWH_DB,
    sourceDb: SOURCE_DB,
    stagingDb: STAGING_DB,
    approvedViews: APPROVED_VIEWS,
    modes: Object.fromEntries(Object.entries(MODES).map(([key, mode]) => [key, {
      label: mode.label,
      model: mode.model,
    }])),
  });
}

function feedbackScoreForAccuracy(feedback) {
  if (!feedback) return null;
  if (feedback.rating === "correct_answer") return 1;
  if (feedback.rating === "wrong_answer") return 0;
  if (feedback.rating === "unclear_answer") return 0.5;
  return null;
}

function feedbackScoreForUsefulness(feedback) {
  if (!feedback) return null;
  if (feedback.thumb === "up" || feedback.rating === "correct_answer") return 1;
  if (feedback.thumb === "down" || feedback.rating === "wrong_answer") return 0;
  if (feedback.rating === "unclear_answer") return 0.5;
  return null;
}

async function handleEvaluationSummary(_req, res) {
  const auditEvents = readJsonLines(QUERY_AUDIT_LOG_FILE);
  const feedbackEvents = readJsonLines(FEEDBACK_LOG_FILE);
  const feedbackByAuditId = new Map();

  for (const feedback of feedbackEvents) {
    if (feedback.auditId) {
      feedbackByAuditId.set(feedback.auditId, feedback);
    }
  }

  const evaluatedEvents = auditEvents.filter((event) => event.evaluation);
  const answerAccuracy = averageScores(evaluatedEvents, (event) => {
    const feedbackScore = feedbackScoreForAccuracy(feedbackByAuditId.get(event.auditId));
    return Number.isFinite(feedbackScore) ? feedbackScore : event.evaluation.answerAccuracy?.score;
  });
  const responseUsefulness = averageScores(evaluatedEvents, (event) => {
    const feedbackScore = feedbackScoreForUsefulness(feedbackByAuditId.get(event.auditId));
    return Number.isFinite(feedbackScore) ? feedbackScore : event.evaluation.responseUsefulness?.score;
  });
  const guardrailEvents = evaluatedEvents.filter((event) => event.evaluation.guardrail?.applicable);
  const guardrailSuccessRate = averageScores(guardrailEvents, (event) => (
    event.evaluation.guardrail?.success === true ? 1 : 0
  ));

  const feedbackTotals = feedbackEvents.reduce((totals, feedback) => {
    if (feedback.rating === "correct_answer") totals.correctAnswer += 1;
    if (feedback.rating === "wrong_answer") totals.wrongAnswer += 1;
    if (feedback.rating === "unclear_answer") totals.unclearAnswer += 1;
    if (feedback.thumb === "up") totals.thumbsUp += 1;
    if (feedback.thumb === "down") totals.thumbsDown += 1;
    return totals;
  }, {
    correctAnswer: 0,
    wrongAnswer: 0,
    unclearAnswer: 0,
    thumbsUp: 0,
    thumbsDown: 0,
  });

  sendJson(res, 200, {
    totals: {
      auditedQueries: auditEvents.filter((event) => event.type !== "human_feedback").length,
      feedback: feedbackEvents.length,
    },
    metrics: {
      sqlCorrectness: averageScores(evaluatedEvents, (event) => event.evaluation.sqlCorrectness?.score),
      answerAccuracy,
      hallucinationRate: averageScores(evaluatedEvents, (event) => event.evaluation.hallucinationRate?.rate),
      responseUsefulness,
      guardrailSuccessRate,
    },
    feedback: feedbackTotals,
    recentAudit: auditEvents
      .filter((event) => event.type !== "human_feedback")
      .slice(-8)
      .reverse()
      .map((event) => ({
        auditId: event.auditId,
        timestamp: event.timestamp,
        type: event.type,
        userQuestion: event.userQuestion,
        generatedSqlCount: Array.isArray(event.generatedSql) ? event.generatedSql.length : 0,
        executionStatus: event.executionStatus,
        responseTimeMs: event.responseTimeMs,
        blockedQueryReason: event.blockedQueryReason || "",
      })),
    logFiles: {
      audit: path.join(LOG_DIR, QUERY_AUDIT_LOG_FILE),
      feedback: path.join(LOG_DIR, FEEDBACK_LOG_FILE),
    },
  });
}

async function handleFeedback(req, res) {
  let payload;

  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON request body." });
    return;
  }

  const allowedRatings = new Set(["correct_answer", "wrong_answer", "unclear_answer"]);
  const rating = String(payload.rating || "");
  if (!allowedRatings.has(rating)) {
    sendJson(res, 400, { error: "Feedback rating must be correct_answer, wrong_answer, or unclear_answer." });
    return;
  }

  const thumb = rating === "correct_answer" ? "up" : rating === "wrong_answer" ? "down" : "";
  const feedback = {
    type: "human_feedback",
    feedbackId: createAuditId("feedback"),
    auditId: String(payload.auditId || ""),
    mode: getMode(payload.mode),
    rating,
    thumb,
    userQuestion: removeThaiText(String(payload.question || "")).slice(0, 12000),
    answer: removeThaiText(String(payload.answer || "")).slice(0, 12000),
    generatedSql: Array.isArray(payload.generatedSql)
      ? payload.generatedSql.map((sql) => String(sql || "").slice(0, 12000))
      : String(payload.generatedSql || "").slice(0, 12000),
    comment: removeThaiText(String(payload.comment || "")).slice(0, 1000),
  };

  logFeedbackEvent(feedback);
  sendJson(res, 201, { ok: true, feedbackId: feedback.feedbackId });
}

async function handleSuggestions(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const modeName = getMode(url.searchParams.get("mode"));
  const mode = MODES[modeName];

  if (modeName !== "sql") {
    sendJson(res, 200, { mode: modeName, model: mode.model, suggestions: [] });
    return;
  }

  const startedAt = Date.now();
  const prompt = [
    "Generate exactly 6 concise clickable prompt suggestions for a user in SQL mode.",
    "The suggestions must be things the user can click to ask you to generate Microsoft SQL Server SELECT queries.",
    `Only target ${DWH_DB}; never mention ${SOURCE_DB} or ${STAGING_DB}.`,
    "Prefer approved Power BI views when useful.",
    "Do not write SQL code. Write user prompt ideas only.",
    "Do not use Thai script.",
    "Return only strict JSON in this shape:",
    '{"suggestions":["Generate SQL ...","Generate SQL ..."]}',
    `Approved views: ${APPROVED_VIEWS.join(", ")}.`,
    `Known warehouse tables: ${WAREHOUSE_TABLES.join(", ")}.`,
    "Metadata follows:",
    getMetadataContext(),
  ].join("\n");

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: mode.model,
        stream: false,
        messages: [
          {
            role: "system",
            content: "You generate safe, useful starter prompts for a banking DWH SQL assistant. Return valid JSON only.",
          },
          { role: "user", content: prompt },
        ],
        options: {
          temperature: 0.35,
          num_ctx: mode.numCtx,
          num_predict: 520,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Ollama returned ${response.status}`);
    }

    const data = await response.json();
    const modelText = removeThaiText(data.message?.content || data.response || "");
    const suggestions = normalizeSuggestionsFromText(modelText);

    if (suggestions.length === 0) {
      throw new Error("The model did not return usable suggestions.");
    }

    logEvent({
      type: "llm_suggestions",
      mode: modeName,
      model: mode.model,
      suggestions,
      responseTimeMs: Date.now() - startedAt,
    });

    sendJson(res, 200, {
      mode: modeName,
      model: mode.model,
      suggestions,
      responseTimeMs: Date.now() - startedAt,
    });
  } catch (error) {
    logEvent({
      type: "llm_suggestions_error",
      mode: modeName,
      model: mode.model,
      error: error.message,
      responseTimeMs: Date.now() - startedAt,
    });

    sendJson(res, 502, {
      error: "Could not generate SQL suggestions from the LLM.",
      detail: error.message,
    });
  }
}

async function handleModels(_req, res) {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const data = await response.json();
    const installedModels = Array.isArray(data.models)
      ? data.models.map((model) => model.name).filter(Boolean)
      : [];
    const requiredModels = Object.values(MODES).map((mode) => mode.model);

    sendJson(res, 200, {
      requiredModels,
      installedModels,
      missingModels: requiredModels.filter((model) => !installedModels.includes(model)),
    });
  } catch (error) {
    sendJson(res, 503, {
      error: "Could not reach Ollama. Make sure Ollama is running.",
      detail: error.message,
    });
  }
}

async function handleChat(req, res) {
  const startedAt = Date.now();
  const auditId = createAuditId("chat");
  let payload;

  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON request body." });
    return;
  }

  const modeName = getMode(payload.mode);
  const mode = MODES[modeName];
  const requestType = payload.requestType === "thinking" ? "thinking" : "answer";
  const clientMessages = sanitizeMessages(payload.messages);
  const question = getLastUserMessage(clientMessages);

  if (clientMessages.length === 0) {
    sendJson(res, 400, { error: "Send at least one message." });
    return;
  }

  const messages = [
    { role: "system", content: buildSystemPrompt(modeName, requestType) },
    ...clientMessages,
  ];
  const temperature = requestType === "thinking" ? Math.min(mode.temperature, 0.2) : mode.temperature;
  let responseText = "";

  try {
    const ollamaResponse = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: mode.model,
        messages,
        stream: true,
        options: {
          temperature,
          num_ctx: mode.numCtx,
          num_predict: requestType === "thinking" ? 220 : mode.answerTokens,
        },
      }),
    });

    if (!ollamaResponse.ok || !ollamaResponse.body) {
      const detail = await ollamaResponse.text();
      throw new Error(detail || `Ollama returned ${ollamaResponse.status}`);
    }

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      "X-Audit-Id": auditId,
    });

    const decoder = new TextDecoder();
    for await (const chunk of ollamaResponse.body) {
      const lines = decoder.decode(chunk, { stream: true }).split("\n").filter(Boolean);
      for (const line of lines) {
        const event = JSON.parse(line);
        if (event.message?.content) {
          const safeContent = removeThaiText(event.message.content);
          responseText += safeContent;
          res.write(safeContent);
        }
        if (event.done) {
          const sqlBlocks = extractSqlBlocks(responseText).map((sql) => ({
            sql,
            validation: validateReadOnlyDwhSql(sql),
          }));
          const blockedQueryReason = sqlBlocks.find((block) => !block.validation.ok)?.validation.error || "";
          const executionStatus = sqlBlocks.length === 0
            ? "no_sql_generated"
            : blockedQueryReason
              ? "sql_validation_failed"
              : "sql_generated";
          const responseTimeMs = Date.now() - startedAt;
          const generatedSql = summarizeSqlBlocks(sqlBlocks);
          const evaluation = evaluateChatInteraction({
            modeName,
            question,
            responseText,
            sqlBlocks,
            executionStatus,
            blockedQueryReason,
          });

          logEvent({
            type: "chat",
            auditId,
            mode: modeName,
            model: mode.model,
            requestType,
            question,
            generatedSql,
            sqlBlocks,
            executionStatus,
            responseTimeMs,
            blockedQueryReason,
            evaluation,
          });

          if (requestType === "answer") {
            logAuditEvent({
              type: "chat_answer",
              auditId,
              mode: modeName,
              model: mode.model,
              userQuestion: question,
              answer: responseText.slice(0, 12000),
              generatedSql,
              executionStatus,
              responseTimeMs,
              blockedQueryReason,
              evaluation,
            });
          }

          res.end();
          return;
        }
      }
    }

    const sqlBlocks = extractSqlBlocks(responseText).map((sql) => ({
      sql,
      validation: validateReadOnlyDwhSql(sql),
    }));
    const responseTimeMs = Date.now() - startedAt;
    const generatedSql = summarizeSqlBlocks(sqlBlocks);
    const evaluation = evaluateChatInteraction({
      modeName,
      question,
      responseText,
      sqlBlocks,
      executionStatus: "chat_stream_ended",
      blockedQueryReason: "",
    });

    logEvent({
      type: "chat_stream_ended",
      auditId,
      mode: modeName,
      model: mode.model,
      requestType,
      question,
      generatedSql,
      executionStatus: "chat_stream_ended",
      responseTimeMs,
      evaluation,
    });

    if (requestType === "answer") {
      logAuditEvent({
        type: "chat_answer",
        auditId,
        mode: modeName,
        model: mode.model,
        userQuestion: question,
        answer: responseText.slice(0, 12000),
        generatedSql,
        executionStatus: "chat_stream_ended",
        responseTimeMs,
        blockedQueryReason: "",
        evaluation,
      });
    }

    res.end();
  } catch (error) {
    logEvent({
      type: "chat_error",
      auditId,
      mode: modeName,
      model: mode.model,
      requestType,
      question,
      error: error.message,
      executionStatus: "chat_failed",
      responseTimeMs: Date.now() - startedAt,
    });

    if (requestType === "answer") {
      logAuditEvent({
        type: "chat_answer",
        auditId,
        mode: modeName,
        model: mode.model,
        userQuestion: question,
        generatedSql: [],
        executionStatus: "chat_failed",
        responseTimeMs: Date.now() - startedAt,
        blockedQueryReason: "",
        error: error.message,
      });
    }

    if (!res.headersSent) {
      sendJson(res, 502, {
        error: "Ollama chat request failed.",
        detail: error.message,
      });
      return;
    }

    res.end(`\n\n[Error: ${error.message}]`);
  }
}

function getSqlPackage() {
  try {
    if (SQL_TRUSTED_CONNECTION) {
      return require("mssql/msnodesqlv8");
    }
    return require("mssql");
  } catch (error) {
    return null;
  }
}

async function getSqlPool() {
  const sql = getSqlPackage();
  if (!sql) {
    throw new Error("SQL package is missing. Run npm install first.");
  }

  if (!SQL_TRUSTED_CONNECTION && (!process.env.SQL_USERNAME || !process.env.SQL_PASSWORD)) {
    throw new Error("Set SQL_USERNAME and SQL_PASSWORD in .env or PowerShell environment variables.");
  }

  if (!sqlPoolPromise) {
    if (SQL_TRUSTED_CONNECTION) {
      const trustCert = SQL_TRUST_SERVER_CERTIFICATE ? "Yes" : "No";
      const connectionString = [
        `Driver={${SQL_DRIVER}}`,
        `Server=${SQL_SERVER}`,
        `Database=${DWH_DB}`,
        "Trusted_Connection=Yes",
        `TrustServerCertificate=${trustCert}`,
      ].join(";");

      sqlPoolPromise = sql.connect({
        connectionString,
        requestTimeout: SQL_QUERY_TIMEOUT_MS,
        pool: {
          max: 4,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      });
    } else {
      sqlPoolPromise = sql.connect({
        server: SQL_SERVER,
        database: DWH_DB,
        user: process.env.SQL_USERNAME,
        password: process.env.SQL_PASSWORD,
        options: {
          encrypt: false,
          trustServerCertificate: SQL_TRUST_SERVER_CERTIFICATE,
        },
        connectionTimeout: 8000,
        requestTimeout: SQL_QUERY_TIMEOUT_MS,
        pool: {
          max: 4,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      });
    }
  }

  return sqlPoolPromise;
}

async function handleSqlRun(req, res) {
  const startedAt = Date.now();
  const executionAuditId = createAuditId("sql");
  let payload;

  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON request body." });
    return;
  }

  const question = removeThaiText(String(payload.question || ""));
  const parentAuditId = String(payload.auditId || "");
  const validation = validateReadOnlyDwhSql(payload.sql);
  if (!validation.ok) {
    const responseTimeMs = Date.now() - startedAt;
    logEvent({
      type: "sql_blocked",
      auditId: executionAuditId,
      parentAuditId,
      question,
      sql: payload.sql,
      error: validation.error,
      executionStatus: "blocked",
      responseTimeMs,
      blockedQueryReason: validation.error,
    });
    logAuditEvent({
      type: "sql_execution",
      auditId: executionAuditId,
      parentAuditId,
      userQuestion: question,
      generatedSql: [String(payload.sql || "")],
      executionStatus: "blocked",
      responseTimeMs,
      blockedQueryReason: validation.error,
      evaluation: {
        sqlCorrectness: {
          score: 0,
          applicable: true,
          generatedCount: 1,
          validCount: 0,
          basis: "SQL execution was blocked by the read-only DWH validator.",
        },
        answerAccuracy: { score: null, confidence: "none", needsHumanReview: true, basis: "No assistant answer was evaluated for this execution event." },
        hallucinationRate: { rate: null, suspectedObjects: [], checkedObjects: 0, basis: "No assistant answer was evaluated for this execution event." },
        responseUsefulness: { score: null, basis: "No assistant answer was evaluated for this execution event." },
        guardrail: {
          applicable: true,
          success: true,
          invalidSqlCount: 1,
          thaiScriptPresent: false,
          blockedQueryReason: validation.error,
          basis: "Unsafe SQL was blocked before execution.",
        },
      },
    });
    sendJson(res, 400, { error: validation.error });
    return;
  }

  try {
    const pool = await getSqlPool();
    const request = pool.request();
    request.timeout = SQL_QUERY_TIMEOUT_MS;
    const result = await request.query(validation.sql);
    const rows = result.recordset || [];
    const responseTimeMs = Date.now() - startedAt;

    logEvent({
      type: "sql_run",
      auditId: executionAuditId,
      parentAuditId,
      question,
      sql: validation.sql,
      rowCount: rows.length,
      warnings: validation.warnings,
      executionStatus: "executed",
      responseTimeMs,
    });
    logAuditEvent({
      type: "sql_execution",
      auditId: executionAuditId,
      parentAuditId,
      userQuestion: question,
      generatedSql: [validation.sql],
      executionStatus: "executed",
      responseTimeMs,
      blockedQueryReason: "",
      rowCount: rows.length,
      warnings: validation.warnings,
      evaluation: {
        sqlCorrectness: {
          score: validation.warnings?.length ? 0.85 : 1,
          applicable: true,
          generatedCount: 1,
          validCount: 1,
          basis: "SQL passed validation and executed successfully.",
        },
        answerAccuracy: { score: null, confidence: "none", needsHumanReview: true, basis: "No assistant answer was evaluated for this execution event." },
        hallucinationRate: { rate: null, suspectedObjects: [], checkedObjects: 0, basis: "No assistant answer was evaluated for this execution event." },
        responseUsefulness: { score: null, basis: "No assistant answer was evaluated for this execution event." },
        guardrail: {
          applicable: true,
          success: true,
          invalidSqlCount: 0,
          thaiScriptPresent: false,
          blockedQueryReason: "",
          basis: "SQL passed read-only DWH guardrails before execution.",
        },
      },
    });

    sendJson(res, 200, {
      dwhDb: DWH_DB,
      sql: validation.sql,
      rowCount: rows.length,
      rows,
      warnings: validation.warnings,
    });
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    logEvent({
      type: "sql_error",
      auditId: executionAuditId,
      parentAuditId,
      question,
      sql: validation.sql,
      error: error.message,
      executionStatus: "failed",
      responseTimeMs,
    });
    logAuditEvent({
      type: "sql_execution",
      auditId: executionAuditId,
      parentAuditId,
      userQuestion: question,
      generatedSql: [validation.sql],
      executionStatus: "failed",
      responseTimeMs,
      blockedQueryReason: "",
      error: error.message,
      evaluation: {
        sqlCorrectness: {
          score: 0.35,
          applicable: true,
          generatedCount: 1,
          validCount: 1,
          basis: "SQL passed safety validation but failed during database execution.",
        },
        answerAccuracy: { score: null, confidence: "none", needsHumanReview: true, basis: "No assistant answer was evaluated for this execution event." },
        hallucinationRate: { rate: null, suspectedObjects: [], checkedObjects: 0, basis: "No assistant answer was evaluated for this execution event." },
        responseUsefulness: { score: null, basis: "No assistant answer was evaluated for this execution event." },
        guardrail: {
          applicable: true,
          success: true,
          invalidSqlCount: 0,
          thaiScriptPresent: false,
          blockedQueryReason: "",
          basis: "SQL passed read-only DWH guardrails before execution.",
        },
      },
    });

    sendJson(res, 500, {
      error: "SQL query failed.",
      detail: error.message,
    });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/config") {
    handleConfig(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/models") {
    handleModels(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/evaluation/summary") {
    handleEvaluationSummary(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/suggestions") {
    handleSuggestions(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    handleChat(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/feedback") {
    handleFeedback(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sql/run") {
    handleSqlRun(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
});

server.listen(PORT, () => {
  console.log(`Local banking DWH assistant: http://localhost:${PORT}`);
  console.log(`Ollama host: ${OLLAMA_HOST}`);
  console.log(`DWH database only: ${DWH_DB}`);
  console.log(`Khmer model: ${MODES.khmer.model}`);
  console.log(`SQL model: ${MODES.sql.model}`);
});
