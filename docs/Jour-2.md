# Jour 2 — Nouvelles fonctionnalités

## Objectif
Implanter la vision communautaire. S'inspirer de c.ai pour l'UX.

## Tâches

### 1. Page découverte communautaire
- Nouvelle page `discover.html`
- Grille de personnages publics avec filtres par catégorie
- Recherche par nom/tag
- Bouton "Démarrer un chat" direct depuis la découverte

### 2. Système de catégories
- Liste de catégories définies : `anime`, `fantasy`, `sci-fi`, `historique`, `original`, `autre`
- Filtres côté frontend sur la page découverte

### 3. Statistiques basiques
- Colonne `chat_count INT DEFAULT 0` sur `characters`
- Incrément à chaque nouvelle session sur ce personnage

## Référence c.ai
- [ ] Analyser les screenshots/flows UX c.ai disponibles
- [ ] Identifier ce qui rend la découverte addictive
- [ ] Reproduire les patterns pertinents

## Résultat attendu
Un utilisateur peut arriver sur le site, parcourir les persos publics et en chatter un sans créer de compte.
