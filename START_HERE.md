# Start Here

This repository contains the local LLM data assistant for the banking loan analytics warehouse.

## What is inside

- `server.js` is the Node.js backend.
- `public/` contains the browser UI.
- `metadata/` contains the approved DWH schema, KPI definitions, rules, and SQL examples.
- `.env.example` shows the required local configuration.

## First setup

```powershell
npm install
Copy-Item .env.example .env
notepad .env
npm start
```

Open the app at:

```text
http://localhost:3000
```

## Required local services

Ollama must be running locally, and the required models must be installed:

```powershell
ollama list
ollama pull gemma4:e4b-it-q4_K_M
ollama pull qwen2.5-coder:3b
```

## Git notes

Do not commit `.env`, `node_modules/`, or `logs/`. Install packages with `npm install` after cloning.
