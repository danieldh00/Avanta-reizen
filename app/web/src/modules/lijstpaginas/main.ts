/**
 * Ingang van de module Lijstpagina's (`/app/lijstpaginas/`, hoort bij `app/src/cms/`), fase V3 van de ombouw
 * (`docs/VUE-OMBOUW.md`).
 */
import { mountModule } from '../../shell/mount';
import { listHeaderRoutes } from './routes';

mountModule({ name: 'lijstpaginas', routes: listHeaderRoutes });
