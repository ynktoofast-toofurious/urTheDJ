import { EventEmitter } from 'events';

type PartyEventCallback = () => void;

const globalStore = globalThis as typeof globalThis & { partyEventBus?: EventEmitter };

const bus: EventEmitter = globalStore.partyEventBus ?? new EventEmitter();
bus.setMaxListeners(200);

if (!globalStore.partyEventBus) {
  globalStore.partyEventBus = bus;
}

function topicFor(sessionId: string) {
  return `party:${sessionId}`;
}

export function emitPartyUpdate(sessionId: string) {
  bus.emit(topicFor(sessionId));
}

export function subscribeToParty(sessionId: string, cb: PartyEventCallback): () => void {
  const topic = topicFor(sessionId);
  bus.on(topic, cb);
  return () => {
    bus.off(topic, cb);
  };
}
