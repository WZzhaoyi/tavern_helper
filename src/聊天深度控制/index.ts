import './settings';
import './设置界面';
import './depth_control';

import { useSettingsStore } from './settings';
import { setDevModeGetter } from './depth_control';

$(() => {
  const settingsStore = useSettingsStore();
  setDevModeGetter(() => settingsStore.settings.dev_mode);
});
