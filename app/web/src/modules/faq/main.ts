/**
 * Ingang van de module Veelgestelde vragen (`/app/faq/`, hoort bij `app/src/cms/`): de eerste module die helemaal in Vue
 * staat (fase V2 van de ombouw, `docs/VUE-OMBOUW.md`).
 */
import { mountModule } from '../../shell/mount';
import { faqRoutes } from './routes';

mountModule({ name: 'faq', routes: faqRoutes });
