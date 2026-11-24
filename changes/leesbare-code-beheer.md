---
titel: Leesbare code in beheer/, system/, backup/ en security/ (P6a.3)
---

## Changelog
- `beheer/routes.js`: het invoerelement van een instelling staat in `renderSettingInput`.
- `beheer/settings.js`: `normalizeUrl` (webadres controleren) en `planChanges` (wat een wijziging schrijft of
  terugzet) uit `validateText` en `update`.
- `beheer/update-routes.js`: versietabel (`renderVersionFacts`) en installatieblok (`renderInstallForm`) apart.
- `beheer/backup-routes.js`: lijst met back-ups in `renderBackupList`.
- `beheer/go-live-check.js`: regels die klaar of open zijn via `readinessRow`.
- `backup/restore-test.js`: `baseRun` en `rowDifferences` uit `evaluateRun`.
- `system/app-log.js`: `cleanDetails` uit `log`; `system/monitor.js`: `recordProblem` en `closeIncidents` uit `runOnce`.
- ESLint bewaakt nu ook complexiteit (20) en bestandslengte (600) in deze vier mappen.
