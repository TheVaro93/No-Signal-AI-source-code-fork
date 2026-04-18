# No-Signal AI — v2 Alpha Community

## What This Is

No-Signal AI est une plateforme de roleplay IA communautaire où les utilisateurs interagissent avec des personnages fictifs créés par la communauté. La v2 ouvre la plateforme au public : découverte de personnages sans compte, chat invité via localStorage, et outils créateurs améliorés. Cible : n'importe qui voulant du roleplay IA sans barrière d'entrée.

## Core Value

Un visiteur non connecté doit pouvoir découvrir des personnages publics et démarrer un chat immédiatement, sans inscription.

## Requirements

### Validated

- ✓ Chat IA en temps réel via SSE (streaming token par token) — existant
- ✓ Authentification Supabase (inscription, connexion, JWT) — existant
- ✓ Personnages privés liés au créateur (`creator_id`) — existant
- ✓ Mémoire RAG avec embeddings vectoriels (pgvector) — existant
- ✓ Upload d'avatar pour les personnages — existant
- ✓ Déploiement Railway avec auto-deploy depuis GitHub main — existant

### Active

- [ ] Personnages publics — colonne `is_public BOOLEAN DEFAULT false` + index
- [ ] Catégories de personnages — colonne `category TEXT` + liste définie (`anime`, `fantasy`, `sci-fi`, `historique`, `original`, `autre`)
- [ ] Route publique `GET /api/characters/public` — sans auth, avec filtres par catégorie
- [ ] Création/édition de personnage accepte `is_public` et `category`
- [ ] System prompt immersif — base narrative améliorée + champs personnalisables par créateur (ton, style)
- [ ] Page découverte `discover.html` — grille de personnages publics, filtres, recherche
- [ ] Chat invité — session sans compte avec historique localStorage (pas de RAG)
- [ ] Statistiques basiques — `chat_count INT DEFAULT 0` incrémenté à chaque session
- [ ] Déploiement Alpha v1.0 stable sur Railway

### Out of Scope

- Modération des personnages — v1.1 après retours Alpha
- Profils utilisateurs publics — v2
- Migration TypeScript — après v1.0 stable (décision explicite)
- Tests automatisés — après v1.0 stable
- OAuth / 2FA — v2
- Système de signalement — v1.1

## Context

Projet solo développé par un développeur de 15 ans. Stack volontairement simple : Express + HTML/CSS/JS vanilla + Supabase + Railway. Pas de bundler, pas de framework frontend — c'est intentionnel.

La v1 existe déjà en production sur Railway (`no-signal-ai-source-code-production.up.railway.app`). La v2 est une évolution, pas une réécriture. Les fichiers critiques sont `backend/server.js` (backend) et `backend/public/app.js` (74KB — frontend complexe).

Le chat invité utilise localStorage pour persister l'historique dans le navigateur, sans aucun stockage Supabase. Les utilisateurs connectés gardent le RAG complet.

## Constraints

- **Stack** : Node.js ESM + Express + HTML/CSS/JS vanilla — pas de framework, pas de TypeScript
- **Taille fichiers** : `server.js` et `app.js` sont gros — modifier un seul à la fois
- **Auth** : Ne jamais bypass `requireAuth` sur une route qui mute des données
- **Sécurité** : Les clés API ne transitent jamais vers le frontend
- **Déploiement** : Railway auto-deploy depuis GitHub `main` — tester localement avant push
- **Timeline** : Plan 5 jours pour Alpha

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Chat invité via localStorage | Pas de compte requis, pas de complexité Supabase anon | — Pending |
| System prompt : base immersive + champs créateur | Meilleure expérience par défaut + personnalisation | — Pending |
| Catégories fixes (6) | Évite la fragmentation, facile à filtrer | — Pending |
| Pas de modération v1 | Alpha = volume faible, modération manuelle possible | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-18 after initialization*
