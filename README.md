# NO-SIGNAL — AI Roleplay Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> A lightweight, open-source AI roleplay platform with character persistence, hybrid memory, and a pluggable AI backend.

**Live demo:** https://no-signal-ai-source-code-production.up.railway.app

---

## Features

- **Real-time chat** — SSE streaming from Groq / Google Gemini
- **Character system** — Create, customize, and share AI personas with avatars
- **Hybrid memory** — Short-term context + long-term summarization + RAG (pgvector embeddings)
- **Session management** — Rename, archive, and delete conversations
- **File uploads** — Send images and files in chat (stored in Supabase Storage)
- **Auth** — Email/password login via Supabase Auth
- **Dark UI** — Discord-inspired minimal interface, no framework
- **Rate limiting** — Built-in per-route rate limiting

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML / CSS / Vanilla JS (no framework, no bundler) |
| Backend | Node.js + Express (ES modules) |
| Database | Supabase (PostgreSQL + pgvector) |
| Auth | Supabase Auth |
| File storage | Supabase Storage |
| AI providers | Groq, Google Gemini (configurable) |
| Embeddings | HuggingFace Inference API (optional, for RAG) |
| Payments | Stripe (optional) |
| Deploy | Railway |


---

## Contributing

Contributions are welcome. Open an issue or submit a pull request.

Keep it simple: no TypeScript, no bundler, no framework.

---

## License

[MIT](LICENSE) — © 2026 Yugos06
