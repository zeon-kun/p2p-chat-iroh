export type ScenarioStep =
  | { peer: 'A' | 'B'; action: 'send'; message: string; delayMs?: number }
  | { action: 'wait'; durationMs: number };

export interface Scenario {
  id: string;
  name: string;
  description: string;
  steps: ScenarioStep[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'basic-chat',
    name: 'Basic Chat',
    description: 'A greets B, B responds, A confirms the link.',
    steps: [
      { peer: 'A', action: 'send', message: 'Hey B — can you hear me?', delayMs: 600 },
      { peer: 'B', action: 'send', message: 'Loud and clear. P2P is live.', delayMs: 1000 },
      { peer: 'A', action: 'send', message: 'Perfect — gossip overlay working end-to-end.', delayMs: 800 },
      { peer: 'B', action: 'send', message: 'Confirmed. No relay hop needed once direct path is up.', delayMs: 900 },
    ],
  },
  {
    id: 'ping-pong',
    name: 'Ping Pong',
    description: 'Rapid alternating messages — tests message ordering under load.',
    steps: [
      { peer: 'A', action: 'send', message: 'ping 1', delayMs: 300 },
      { peer: 'B', action: 'send', message: 'pong 1', delayMs: 300 },
      { peer: 'A', action: 'send', message: 'ping 2', delayMs: 300 },
      { peer: 'B', action: 'send', message: 'pong 2', delayMs: 300 },
      { peer: 'A', action: 'send', message: 'ping 3', delayMs: 300 },
      { peer: 'B', action: 'send', message: 'pong 3', delayMs: 300 },
      { peer: 'A', action: 'send', message: 'ping 4', delayMs: 300 },
      { peer: 'B', action: 'send', message: 'pong 4', delayMs: 300 },
    ],
  },
  {
    id: 'broadcast-burst',
    name: 'Broadcast Burst',
    description: 'A floods with 5 messages; B receives all and acknowledges.',
    steps: [
      { peer: 'A', action: 'send', message: 'Burst 1/5 — starting transmission', delayMs: 250 },
      { peer: 'A', action: 'send', message: 'Burst 2/5 — gossip fan-out test', delayMs: 250 },
      { peer: 'A', action: 'send', message: 'Burst 3/5 — nonce dedup active', delayMs: 250 },
      { peer: 'A', action: 'send', message: 'Burst 4/5 — checking delivery order', delayMs: 250 },
      { peer: 'A', action: 'send', message: 'Burst 5/5 — transmission complete', delayMs: 250 },
      { action: 'wait', durationMs: 1000 },
      { peer: 'B', action: 'send', message: 'All 5 received, no duplicates detected.', delayMs: 0 },
    ],
  },
  {
    id: 'cross-talk',
    name: 'Cross-Talk',
    description: 'Both peers send simultaneously — validates concurrent message handling.',
    steps: [
      { peer: 'A', action: 'send', message: 'A: sending at the same time as B...', delayMs: 100 },
      { peer: 'B', action: 'send', message: "B: same here, let's see the ordering", delayMs: 100 },
      { action: 'wait', durationMs: 1400 },
      { peer: 'A', action: 'send', message: "A: got yours — timestamps look stable", delayMs: 500 },
      { peer: 'B', action: 'send', message: 'B: confirmed — gossip ordering consistent', delayMs: 600 },
    ],
  },
];
