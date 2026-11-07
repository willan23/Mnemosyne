import { events as createPointerEvents } from '@react-three/fiber';

export const attachedSceneEvents: typeof createPointerEvents = (store) => {
  const events = createPointerEvents(store);
  return {
    ...events,
    connect: (target) => {
      // Canvas setup can finish after its route or view has unmounted.
      if (target?.isConnected) events.connect?.(target);
    },
  };
};
