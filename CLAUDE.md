# CLAUDE.md — No-Signal AI

> Lis ce fichier entièrement avant de toucher quoi que ce soit.

---

## Ce qu'est ce projet

No-Signal AI est une plateforme de roleplay IA communautaire.
L'objectif : donner aux gens un espace pour interagir avec des personnages fictifs créés par la communauté, sans barrière d'âge arbitraire, avec des modèles gratuits.

C'est un projet solo, développé par un développeur de 15 ans. Le code est intentionnel et réfléchi. Ne le réécris pas sans raison valable.

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Backend | Node.js (ESM), Express |
| Base de données | Supabase (PostgreSQL + Auth + Storage) |
| Frontend | HTML/CSS/JS vanilla |
| AI | Multi-modèles via registre configurable (OpenAI-compatible) |
| Mémoire | RAG avec embeddings vectoriels (pgvector) |
| Paiements | Stripe (optionnel) |
| Déploiement | Railway |

---

## Structure du projet

```
/
├── backend/
│   ├── server.js          # Point d'entrée — toute la logique backend
│   ├── package.json
│   └── public/            # Frontend statique servi par Express
│       ├── index.html     # Interface principale de chat
│       ├── app.js         # Logique frontend principale (74K — complexe)
│       ├── auth.html/js   # Authentification
│       ├── characters.html/js  # Gestion des personnages
│       ├── subscribe.html # Page d'abonnement Stripe
│       ├── config.js      # Config frontend
│       └── style.css      # Styles globaux
├── docs/                  # Documentation interne (gitignorée)
├── CLAUDE.md              # Ce fichier
├── README.md
└── LICENSE
```

---

## Architecture backend — points clés

### Modèles AI
Les modèles sont définis dans `.private/ai-config.json` (jamais committé).
Le registre est abstrait — n'importe quelle API OpenAI-compatible fonctionne (Gemini, Groq, etc.).
`getModel(key)` résout le modèle depuis `MODEL_REGISTRY`.

### Auth
`requireAuth` middleware — vérifie le JWT Supabase sur chaque route protégée.
`getUserClient(req)` — client Supabase avec le token user pour respecter les RLS policies.

### Mémoire (RAG)
- `embedText(text)` — génère un embedding via API configurable
- `searchMemories(userId, embedding)` — recherche vectorielle dans `memory_vectors`
- `storeMemory(...)` — stocke un échange en mémoire vectorielle
- `buildSystemPrompt(character, summary, userPersona, ragContext)` — construit le prompt système

### Streaming
Le chat utilise SSE (Server-Sent Events) via `/chat` POST.
Le frontend lit le stream token par token.

### Personnages
Actuellement **privés** — liés à `creator_id`.
**Priorité v2 : rendre publics et partageables.**

---

## Ce qui manque (backlog v2)

### Priorité haute
- [ ] Personnages publics — colonne `is_public` + route de découverte
- [ ] Catégories de personnages — colonne `category` + filtres
- [ ] System prompt amélioré — `buildSystemPrompt` est basique, c'est le cœur du produit
- [ ] Modération minimale — signalement de personnages

### Priorité moyenne
- [ ] Page de découverte communautaire
- [ ] Profils utilisateurs publics
- [ ] Statistiques de personnages (nb de chats)

### Plus tard
- [ ] Migration TypeScript (après v1.0 stable)
- [ ] Tests automatisés

---

## Conventions de code

- ESM uniquement (`import/export`) — pas de `require()`
- Pas de frameworks frontend — HTML/CSS/JS vanilla
- Toujours valider les inputs côté backend avant Supabase
- Toujours vérifier `creator_id === req.user.id` avant toute mutation
- Les clés API ne transitent jamais vers le frontend

---

## Variables d'environnement requises

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
AI_CONFIG_JSON         # ou AI_CONFIG_PATH vers le fichier
ALLOWED_ORIGIN         # origines CORS autorisées
STRIPE_SECRET_KEY      # optionnel
STRIPE_PRICE_ID        # optionnel
DEV_EMAILS             # emails avec accès dev
DEV_BADGE_CONFIG       # JSON badges par email
```

---

## Règles absolues

1. **Ne jamais exposer les clés API au frontend**
2. **Ne jamais bypass requireAuth sur une route qui mute des données**
3. **Ne jamais écrire dans la DB sans vérifier l'ownership**
4. **Tester localement avant de proposer un déploiement**
5. **Un seul fichier modifié à la fois sur les gros fichiers (server.js, app.js)**
