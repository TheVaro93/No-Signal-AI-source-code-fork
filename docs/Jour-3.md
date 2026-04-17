# Jour 3 — Debug & Stabilisation

## Objectif
Tuer tous les bugs avant la sortie Alpha. Journée chirurgicale.

## Process
1. Tester chaque flow utilisateur de bout en bout
2. Tester sur mobile (responsive)
3. Tester les edge cases (perso sans lore, message vide, session expirée)
4. Vérifier les erreurs Supabase dans les logs Railway
5. Vérifier le comportement du stream SSE sur connexion lente

## Checklist de test
- [ ] Inscription / Connexion
- [ ] Créer un personnage public + privé
- [ ] Découverte — filtres par catégorie
- [ ] Démarrer un chat depuis découverte (sans compte)
- [ ] Démarrer un chat connecté (avec mémoire RAG)
- [ ] Archiver / supprimer une session
- [ ] Modifier un personnage
- [ ] Supprimer un personnage
- [ ] Rate limiting (spam messages)
- [ ] Upload avatar

## Résultat attendu
Zéro crash bloquant. Les bugs mineurs sont listés et priorisés.
