import { useSettingsStore } from './settings';

let hiddenByUs: number[] = [];

eventOn(tavern_events.GENERATION_AFTER_COMMANDS, async (_type, _option, dry_run) => {
  const { settings } = useSettingsStore();
  if (!settings.enabled || dry_run) return;

  const lastId = getLastMessageId();
  if (lastId < 0) return;

  const unhiddenMessages = getChatMessages(`0-${lastId}`, {
    hide_state: 'unhidden',
  }).filter(m => m.role !== 'system');

  if (unhiddenMessages.length <= settings.max_depth) return;

  const toHide = unhiddenMessages.slice(0, unhiddenMessages.length - settings.max_depth);
  hiddenByUs = toHide.map(m => m.message_id);

  await setChatMessages(
    hiddenByUs.map(id => ({ message_id: id, is_hidden: true })),
    { refresh: 'none' },
  );
});

async function restore() {
  if (hiddenByUs.length === 0) return;
  await setChatMessages(
    hiddenByUs.map(id => ({ message_id: id, is_hidden: false })),
    { refresh: 'none' },
  );
  hiddenByUs = [];
}

eventOn(tavern_events.GENERATION_ENDED, restore);
eventOn(tavern_events.GENERATION_STOPPED, restore);
