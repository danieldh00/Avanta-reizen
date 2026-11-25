/**
 * Ingang van de module Reistypes en landen (`/app/reistypes-en-landen/`, hoort bij `app/src/trips/`), fase V3 van de
 * ombouw (`docs/VUE-OMBOUW.md`).
 */
import { mountModule } from '../../shell/mount';
import { categoryRoutes } from './routes';

mountModule({ name: 'reistypes', routes: categoryRoutes });
