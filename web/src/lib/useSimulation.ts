import { useState, useEffect, useRef, useCallback } from 'react';
import { useChatSocket } from './useChatSocket';
import type { Scenario } from './simulationScenarios';

export type SimPhase =
  | 'idle'       // waiting for user to start
  | 'waiting-a'  // peerA connecting + opening room
  | 'waiting-b'  // peerB joining with A's ticket
  | 'ready'      // both peers in room, scenario can run
  | 'running'    // scenario steps executing
  | 'done'       // scenario finished
  | 'error';     // a connection failed

export interface SimulationState {
  peerA: ReturnType<typeof useChatSocket>;
  peerB: ReturnType<typeof useChatSocket>;
  phase: SimPhase;
  activeScenario: Scenario | null;
  stepIndex: number;
  errorMsg: string | null;
  startSim: () => void;
  runScenario: (scenario: Scenario) => void;
  reset: () => void;
  runAgain: () => void;
}

const ROOM_NAME = 'sim-room';

export function useSimulation(portA = 9001, portB = 9002): SimulationState {
  const [phase, setPhase]               = useState<SimPhase>('idle');
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
  const [stepIndex, setStepIndex]       = useState(-1);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);

  // Guards to prevent effects from firing multiple times
  const openSentRef   = useRef(false);
  const joinSentRef   = useRef(false);
  const cancelRef     = useRef(false);
  const phaseRef      = useRef<SimPhase>('idle');

  phaseRef.current = phase;

  // Both WS connections are always live (connect on mount).
  // We drive them manually via openRoom / joinRoom rather than auto-send.
  const peerA = useChatSocket({ port: portA, mode: 'serve' });
  const peerB = useChatSocket({ port: portB, mode: 'serve' });

  // Phase waiting-a: open room on A as soon as its WS is up
  useEffect(() => {
    if (phase !== 'waiting-a' || openSentRef.current) return;
    if (peerA.connectionState === 'connected') {
      openSentRef.current = true;
      peerA.openRoom(ROOM_NAME);
    }
  }, [phase, peerA.connectionState, peerA.openRoom]);

  // Phase waiting-a → waiting-b: A has a ticket; hand it to B
  useEffect(() => {
    if (phase !== 'waiting-a' || !peerA.roomTicket || joinSentRef.current) return;
    joinSentRef.current = true;
    setPhase('waiting-b');
    peerB.joinRoom(ROOM_NAME, peerA.roomTicket);
  }, [phase, peerA.roomTicket, peerB.joinRoom]);

  // Phase waiting-b → ready: B's room state flips to ready
  useEffect(() => {
    if (phase !== 'waiting-b') return;
    if (peerB.roomState === 'ready') setPhase('ready');
  }, [phase, peerB.roomState]);

  // Error detection: backend disconnected while we're in a connecting phase
  useEffect(() => {
    if (phase === 'waiting-a' && peerA.connectionState === 'disconnected') {
      setPhase('error');
      setErrorMsg(`Peer A backend not reachable on ws://127.0.0.1:${portA}. Run: cargo run --bin chat -- serve --ws-port ${portA}`);
    }
    if (phase === 'waiting-b' && peerB.connectionState === 'disconnected') {
      setPhase('error');
      setErrorMsg(`Peer B backend not reachable on ws://127.0.0.1:${portB}. Run: cargo run --bin chat -- serve --ws-port ${portB}`);
    }
    if (phase === 'ready' || phase === 'running') {
      if (peerA.connectionState === 'disconnected' || peerB.connectionState === 'disconnected') {
        cancelRef.current = true;
        setPhase('error');
        setErrorMsg('A peer disconnected. Reset to try again.');
      }
    }
  }, [phase, peerA.connectionState, peerB.connectionState, portA, portB]);

  const startSim = useCallback(() => {
    openSentRef.current = false;
    joinSentRef.current = false;
    cancelRef.current   = false;
    setPhase('waiting-a');
    setErrorMsg(null);
    setActiveScenario(null);
    setStepIndex(-1);
  }, []);

  const runScenario = useCallback((scenario: Scenario) => {
    if (phaseRef.current !== 'ready') return;
    cancelRef.current = false;
    setActiveScenario(scenario);
    setStepIndex(0);
    setPhase('running');

    const sendA = peerA.send;
    const sendB = peerB.send;

    async function execute() {
      for (let i = 0; i < scenario.steps.length; i++) {
        if (cancelRef.current) return;
        setStepIndex(i);
        const step = scenario.steps[i];

        if (step.action === 'wait') {
          await new Promise<void>(r => setTimeout(r, step.durationMs));
        } else {
          if (step.delayMs) await new Promise<void>(r => setTimeout(r, step.delayMs));
          if (cancelRef.current) return;
          (step.peer === 'A' ? sendA : sendB)(step.message);
        }
      }
      if (!cancelRef.current) {
        setPhase('done');
        setStepIndex(-1);
      }
    }

    execute();
  }, [peerA.send, peerB.send]);

  const reset = useCallback(() => {
    cancelRef.current   = true;
    openSentRef.current = false;
    joinSentRef.current = false;
    if (peerA.roomState === 'ready') peerA.leave();
    if (peerB.roomState === 'ready') peerB.leave();
    setPhase('idle');
    setActiveScenario(null);
    setStepIndex(-1);
    setErrorMsg(null);
  }, [peerA, peerB]);

  const runAgain = useCallback(() => {
    if (phaseRef.current !== 'done') return;
    setActiveScenario(null);
    setStepIndex(-1);
    setPhase('ready');
  }, []);

  return {
    peerA, peerB,
    phase, activeScenario, stepIndex, errorMsg,
    startSim, runScenario, reset, runAgain,
  };
}
