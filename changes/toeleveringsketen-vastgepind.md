---
titel: Actions en images vastgepind, image-scan en SBOM
---

## Changelog
- Alle GitHub Actions op een volledige commit-SHA en alle container-images (workflows, `app/Dockerfile`,
  `docker-compose.yml`, `deploy/apps01`) op een digest; `tests/vastgepind.test.js` bewaakt dat, Renovate houdt ze bij
  (`helpers:pinGitHubActionDigests`, `docker:pinDigests` en een eigen regel voor images in `docker run`).
- CI (job `image`) scant het image met Trivy (HIGH/CRITICAL met oplossing laat de job falen; uitzonderingen in
  `app/.trivyignore`) en bewaart een SBOM (CycloneDX). `release.yml` scant vóór het pushen en zet SBOM en herkomst als
  attestatie bij het image in GHCR.
- De geheimenscan (`secrets`) wordt een verplichte controle in de ruleset (A12, A26).
