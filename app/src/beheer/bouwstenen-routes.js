// @ts-check
/**
 * Beheer > Systeem > Bouwstenen (`/app/beheer/bouwstenen/`, recht `systeem`): het eerste scherm in Vue. Het toont de
 * bouwstenen van de nieuwe schermen met een voorbeeld van elk, zodat de design-controle en axe ze op 1440 en 375 px
 * kunnen nalopen. De server levert de pagina met de bestaande schil en in het midden het koppelpunt van de module
 * `beheer` (`app/web/src/modules/beheer/`); het scherm bevat geen gegevens.
 */
const express = require('express');
const { renderMountPoint } = require('../crm/web-bundle');

/**
 * Bouwt de route.
 * @param {{guard: Function, webBundle: {assetsFor: (name: string) => any}, renderBeheerPage: Function}} options
 *   Rechtcontrole (`systeem`), lezer van het manifest en de paginaopbouw van Beheer.
 * @returns {express.Router} Router.
 */
function createBouwstenenRoutes(options) {
  const router = express.Router();
  router.get('/beheer/bouwstenen/', options.guard, (req, res) => {
    const bundle = options.webBundle.assetsFor('beheer');
    res.send(options.renderBeheerPage(req, {
      title: 'Bouwstenen',
      sectionId: 'bouwstenen',
      bundle,
      body: renderMountPoint({ name: 'beheer', base: '/app/beheer/', available: Boolean(bundle) }),
    }));
  });
  return router;
}

module.exports = { createBouwstenenRoutes };
