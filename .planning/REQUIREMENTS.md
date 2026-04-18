# Requirements: No-Signal AI — v2 Alpha Community

**Defined:** 2026-04-18
**Core Value:** Un visiteur non connecté doit pouvoir découvrir des personnages publics et démarrer un chat immédiatement, sans inscription.

## v1 Requirements

### Characters (CHAR)

- [ ] **CHAR-01**: Créateur peut marquer un personnage comme public (`is_public`)
- [ ] **CHAR-02**: Créateur peut assigner une catégorie (anime, fantasy, sci-fi, historique, original, autre)
- [ ] **CHAR-03**: Invité peut consulter tous les personnages publics sans se connecter
- [ ] **CHAR-04**: Invité peut filtrer les personnages publics par catégorie

### System Prompt (SYSP)

- [ ] **SYSP-01**: Le system prompt adopte un ton narratif immersif par défaut (cohérence personnage, réponses contextuelles)
- [ ] **SYSP-02**: Créateur peut définir ton et style dans la fiche personnage (champs personnalisables)
- [ ] **SYSP-03**: Le nouveau system prompt est rétrocompatible avec les personnages existants

### Discovery (DISC)

- [ ] **DISC-01**: Page `discover.html` avec grille de personnages publics
- [ ] **DISC-02**: Filtres par catégorie sur la page découverte
- [ ] **DISC-03**: Recherche par nom sur la page découverte
- [ ] **DISC-04**: Bouton "Démarrer un chat" direct depuis la page découverte

### Guest Chat (GUEST)

- [ ] **GUEST-01**: Invité peut démarrer un chat avec un personnage public sans créer de compte
- [ ] **GUEST-02**: Historique de chat invité persisté dans localStorage
- [ ] **GUEST-03**: Invité n'a pas accès au RAG (session temporaire uniquement)

### Stats & Backend (STAT)

- [ ] **STAT-01**: Compteur de chats (`chat_count`) incrémenté et affiché sur chaque personnage public
- [ ] **DB-01**: Migration Supabase appliquée (colonnes `is_public`, `category`, `chat_count` + index)
- [ ] **DB-02**: Route `GET /api/characters/public` accessible sans authentification

### Déploiement (DEP)

- [ ] **DEP-01**: Checklist Alpha Railway validée (env vars, health check `/health`, premier personnage public créé)

## v2 Requirements

### Modération

- **MODR-01**: Utilisateur peut signaler un personnage problématique
- **MODR-02**: Admin peut supprimer un personnage signalé

### Profils

- **PROF-01**: Page de profil public par créateur
- **PROF-02**: Liste des personnages publics d'un créateur

### Auth améliorée

- **AUTH-01**: Connexion OAuth (Google)
- **AUTH-02**: Authentification 2FA

## Out of Scope

| Feature | Reason |
|---------|--------|
| Migration TypeScript | Après v1.0 stable — décision explicite du projet |
| Tests automatisés | Après v1.0 stable |
| App mobile native | Web-first |
| Notifications email | v1.1 |
| Système de paiement évolué | Stripe déjà intégré, pas d'évolution v1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | Phase 1 | Pending |
| CHAR-01 | Phase 1 | Pending |
| CHAR-02 | Phase 1 | Pending |
| SYSP-01 | Phase 1 | Pending |
| SYSP-02 | Phase 1 | Pending |
| SYSP-03 | Phase 1 | Pending |
| DB-02 | Phase 1 | Pending |
| DISC-01 | Phase 2 | Pending |
| DISC-02 | Phase 2 | Pending |
| DISC-03 | Phase 2 | Pending |
| DISC-04 | Phase 2 | Pending |
| CHAR-03 | Phase 2 | Pending |
| CHAR-04 | Phase 2 | Pending |
| GUEST-01 | Phase 2 | Pending |
| GUEST-02 | Phase 2 | Pending |
| GUEST-03 | Phase 2 | Pending |
| STAT-01 | Phase 2 | Pending |
| DEP-01 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-18*
*Last updated: 2026-04-18 after initial definition*
