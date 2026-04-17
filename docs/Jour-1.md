# Jour 1 — Fondations v2

## Objectif
Amélioration backend + poser les bases de la vision communautaire.

## Tâches

### 1. Personnages publics
- Ajouter colonne `is_public BOOLEAN DEFAULT false` dans la table `characters`
- Ajouter colonne `category TEXT` dans la table `characters`
- Nouvelle route `GET /api/characters/public` — accessible sans auth, retourne les persos publics
- Modifier `POST /api/characters` et `PUT /api/characters/:id` pour accepter `is_public` et `category`

### 2. System prompt amélioré
- Réécrire `buildSystemPrompt` pour un roleplay plus immersif
- Ajouter instructions de ton, de cohérence narrative, de réponse contextuelle
- Garder la rétrocompatibilité avec les persos existants

### 3. Nettoyage backend général
- Audit des routes existantes
- Vérifier tous les cas d'erreur

## Migration SQL à appliquer sur Supabase

```sql
ALTER TABLE characters ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';

-- Index pour les persos publics
CREATE INDEX IF NOT EXISTS idx_characters_public ON characters(is_public) WHERE is_public = true;
```

## Résultat attendu en fin de journée
Backend capable de servir des personnages publics.
