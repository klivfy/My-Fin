// The myfin theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in myfin.settings.json and the generated myfin.settings.ts;
// change them with `astryx experimental theme editor set myfin ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {myfinSettings} from './myfin.settings';

export const myfinTheme = defineTheme({
  extends: myfinSettings,
  name: 'myfin',
});
