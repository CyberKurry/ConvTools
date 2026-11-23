import manifest from './module.json';
import { defineToolModule } from '../../core/module-sdk';

export default defineToolModule({
  manifest,
  runtime: {
    id: '{{id}}',
    icon: manifest.icon,
    surfaces: {
      popup: null,
      workbench: null,
      settings: null,
      selectionActions: [],
    },
  },
});
