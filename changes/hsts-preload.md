---
titel: HSTS-preload als instelling voor na de livegang
---

## Nieuws
- Beheer > Toegang en beveiliging heeft een schakelaar *HSTS-preload*. Zet hem pas aan na een stabiele periode na de livegang; de controle voor de livegang toont hem als stap voor later.

## Changelog
- `server.js`: `hstsValue()` stuurt `max-age=63072000; includeSubDomains; preload` alleen als `hstsPreload` aan staat, de site live is (`seoIndexing`) en het verzoek op de host van het basisadres (`siteUrl`) binnenkomt; anders blijft het `max-age=31536000`. De testomgeving (altijd noindex, eigen host) krijgt nooit `preload`. De kop wordt pas gezet na `settings.ready()`, dus ook het eerste verzoek na een start volgt Beheer; de instelling heeft geen omgevingsvariabele.
- Nieuwe instelling `hstsPreload` (sectie *HSTS-preload* in Toegang en beveiliging, bevestiging bij aanzetten) en een regel in de controle voor de livegang (`later` tot hij aan staat).
- Tests voor alle voorwaarden, de livegangregel en een integratietest via de echte app (`test/hsts-preload.test.js`); `docs/GO-LIVE.md` §4.5 beschrijft de stappen (subdomeinen, kale domein, hstspreload.org).
