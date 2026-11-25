/**
 * Ingang van de module Categorieën en tags van het blog (`/app/blog/categorieen-en-tags/`, hoort bij `app/src/cms/`),
 * fase V3 van de ombouw (`docs/VUE-OMBOUW.md`).
 */
import { mountModule } from '../../shell/mount';
import { termRoutes } from './routes';

mountModule({ name: 'blog-indeling', routes: termRoutes });
