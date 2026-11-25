/**
 * Ingang van de module Menu's (`/app/menus/`, hoort bij `app/src/cms/`), fase V3 van de ombouw (`docs/VUE-OMBOUW.md`).
 */
import { mountModule } from '../../shell/mount';
import { menuRoutes } from './routes';

mountModule({ name: 'menus', routes: menuRoutes });
