# Déploiement et rollback Au Pluriel

Le VPS conserve les builds dans `/home/ubuntu/releases`. Le lien
`/home/ubuntu/app/.output` désigne toujours la version active.

## Déployer

```bash
/home/ubuntu/deploy.sh
```

Pour déployer l’état exact d’un workspace local qui n’est pas encore sur
GitHub :

```bash
/home/ubuntu/deploy.sh --source-archive /home/ubuntu/incoming/source.tgz
```

Le script :

1. verrouille le déploiement pour empêcher deux opérations simultanées ;
2. vérifie et sauvegarde SQLite ;
3. construit le projet sans toucher à la version active ;
4. échange atomiquement le lien `.output` ;
5. redémarre `lio23.service` ;
6. vérifie le service, `/api/health` et l’intégrité SQLite ;
7. restaure automatiquement la version précédente en cas d’échec.

## Rollback manuel

```bash
/home/ubuntu/rollback.sh --list
/home/ubuntu/rollback.sh
```

Sans argument, le script choisit la release saine la plus récente qui n’est
pas active. Il est aussi possible de fournir un dossier précis :

```bash
/home/ubuntu/rollback.sh /home/ubuntu/releases/20260802T120000Z-abc1234
```

## Journaux et sauvegardes

- Journaux : `/home/ubuntu/deploy-logs`
- Sauvegardes SQLite : `/home/ubuntu/backups/lio23-*.db`
- Releases : `/home/ubuntu/releases`

Le rollback automatique restaure le code, pas la base de données. Restaurer
automatiquement SQLite pourrait supprimer des trades enregistrés entre le
déploiement et le contrôle de santé. La sauvegarde reste disponible pour une
restauration manuelle exceptionnelle.
