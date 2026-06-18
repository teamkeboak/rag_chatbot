@echo off
REM ── Banking RAG Chatbot — start all services ─────────────────────────────

REM 1. Install Python dependencies (first run only)
echo [1/4] Checking Python dependencies...
pip install -r requirements.txt -q

REM 2. Pull Ollama embedding model (first run only)
echo [2/4] Pulling Ollama models...
ollama pull nomic-embed-text
ollama pull qwen2.5-coder:3b
ollama pull gemma4:e4b-it-q4_K_M

REM 3. Build vector index from metadata files
echo [3/4] Building retrieval index...
cd retrieval_engine
python build_index.py
cd ..

REM 4. Start the retrieval service in a new window
echo [4/4] Starting retrieval service on :8001 ...
start "RAG Retrieval Service" cmd /k "cd retrieval_engine && uvicorn retrieve_context:app --host 0.0.0.0 --port 8001"

echo.
echo Retrieval service starting at http://localhost:8001
echo Now start the Node.js server:  npm start
echo.
pause
