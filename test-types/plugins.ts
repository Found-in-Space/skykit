import {
  createSnapshotController,
  type HookMap,
  type SkyKitBuiltinHookMap,
  type SkyKitCommand,
  type SkyKitEvent,
  type SkyKitPlugin,
  type SnapshotControllerEvent,
} from '@found-in-space/skykit';

type AppSnapshot = {
  label: string;
  count: number;
};

type AppCommand = SkyKitCommand<'app/set-label', { label: string }, { applied: boolean }>;
type AppEvent = SkyKitEvent<'app/labeled', { label: string }, AppSnapshot>;
type AppEvents = SnapshotControllerEvent<AppSnapshot, AppCommand> | AppEvent;

interface AppHooks extends SkyKitBuiltinHookMap<AppSnapshot, AppCommand, AppEvents> {
  'app:label': (value: string, context: {
    getSnapshot(): AppSnapshot;
  }) => string | void | Promise<string | void>;
}

const controller = createSnapshotController<AppSnapshot, AppCommand, AppEvents, AppHooks>({
  initialSnapshot: {
    label: 'init',
    count: 0,
  },
});

controller.registerHook('app:label', (value, api) => {
  return `${value}:${api.getSnapshot().count}`;
});

const plugin: SkyKitPlugin<AppSnapshot, AppCommand, AppEvents, AppHooks> = {
  name: 'typed-plugin',
  setup(api) {
    api.registerHook('app:label', (value) => value.toUpperCase());
    api.subscribe((event) => {
      if (event.type === 'app/labeled') {
        const label: string = event.label;
        void label;
      }
    });
    return () => {};
  },
};

controller.registerPlugin(plugin);
