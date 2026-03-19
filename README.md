# No-Signa-AI-source-code-
the official repo of the no-signa.ai site, it is private and protected by License, source code do NOT leak any information !
# 🧠 NO-SIGNAL — AI Roleplay Platform

> A lightweight, customizable AI roleplay platform focused on character consistency, memory systems, and developer control.

---

## 🚀 Overview

**NO-SIGNAL** is an experimental AI-powered roleplay platform designed to replicate and improve the core experience of modern AI chat systems.

Unlike traditional platforms, NO-SIGNAL focuses on:

* 🧩 Structured character design
* 🧠 Memory persistence (short & long-term)
* 🔓 Flexibility (local or external AI models)
* ⚙️ Full developer control over prompts and behavior

---

## ✨ Features

* 💬 Real-time AI chat interface
* 👤 Custom character creation system
* 🧠 Memory engine (context + summarization)
* 🔌 Pluggable AI backend (OpenAI / Claude / local models)
* 🌙 Minimalist dark UI (Discord-inspired)

---

## 🏗️ Architecture

```
Frontend (GitHub Pages)
│
├── UI (HTML / CSS / JS)
│
Backend (API Layer)
│
├── /chat        → AI interaction
├── /memory      → context storage
├── /character   → character management
│
AI Engine
│
├── External APIs (Claude / GPT / Gemini)
└── Local Models (Ollama / vLLM)
```

---

## 🧠 Memory System

NO-SIGNAL uses a hybrid memory system:

### 🔹 Short-term memory

Recent conversation messages (last N interactions)

### 🔹 Long-term memory

Summarized context stored and injected into prompts

### 🔹 Character core

Structured personality definition:

```
Name: Aiko  
Personality: Cold, sarcastic  
Tone: Short, ironic responses  
Lore: Cyberpunk hacker  
```

---

## ⚙️ Tech Stack

* Frontend: HTML, CSS, JavaScript
* Backend: Node.js / Cloudflare Workers
* AI: Claude API / OpenAI / Ollama
* Storage: JSON (MVP) → Database (future)

---

## 🔐 Security

* API keys stored server-side only
* No sensitive data exposed to client
* Request validation & rate limiting planned

---

## 📦 Installation (MVP)

```bash
git clone https://github.com/Yugos06/NO-SIGNAL-
cd NO-SIGNAL-
```

### Frontend

Open `index.html` or deploy via GitHub Pages

### Backend

```bash
npm install
npm run dev
```

---

## 🧪 Development Roadmap

* [x] Basic chat UI
* [x] AI integration
* [ ] Character system
* [ ] Memory engine
* [ ] Auth system
* [ ] Multi-user support
* [ ] Local model integration

---

## ⚠️ Disclaimer

This project is experimental and under active development.
Expect bugs, inconsistencies, and rapid changes.

---

## 🤝 Contributing

Contributions, ideas, and feedback are welcome.

---

## 🧑‍💻 Author

Developed by **Yugos06**
Junior developer exploring AI, Linux, and game development.

---

## 🪐 Vision

Build a fully customizable, open AI roleplay system that gives control back to developers and users.

---

> “Control the character. Control the story.”
