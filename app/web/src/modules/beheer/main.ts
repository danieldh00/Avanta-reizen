/**
 * Ingang van de module Beheer (`/app/beheer/`). Voorlopig alleen het overzicht van de bouwstenen; de schermen van
 * Beheer zelf komen in fase V7.
 */
import { mountModule } from '../../shell/mount';
import { beheerRoutes } from './routes';

mountModule({ name: 'beheer', routes: beheerRoutes });
