import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  feedback,
  isSoundEnabled,
  playFeedback,
  resetSoundPreference,
  setSoundEnabled,
  subscribeSound,
} from "./feedback";

type FakeOscillator = {
  connect: () => void;
  frequency: { setValueAtTime: (value: number, at: number) => void };
  start: (at: number) => void;
  stop: (at: number) => void;
  type: string;
};

/** Records what an oscillator would have been asked to do, without audio. */
function installAudioContext() {
  const frequencies: number[] = [];
  const oscillators: FakeOscillator[] = [];

  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    state = "running";
    createOscillator(): FakeOscillator {
      const oscillator: FakeOscillator = {
        connect: () => undefined,
        frequency: {
          setValueAtTime: (value: number) => {
            frequencies.push(value);
          },
        },
        start: () => undefined,
        stop: () => undefined,
        type: "",
      };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      return {
        connect: () => undefined,
        gain: {
          exponentialRampToValueAtTime: () => undefined,
          setValueAtTime: () => undefined,
        },
      };
    }
    close() {}
  }

  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: FakeAudioContext,
    writable: true,
  });

  return { frequencies, oscillators };
}

function installVibration() {
  const vibrate = vi.fn(() => true);
  Object.defineProperty(globalThis.navigator, "vibrate", {
    configurable: true,
    value: vibrate,
    writable: true,
  });
  return vibrate;
}

function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({ matches, media: query })),
    writable: true,
  });
}

describe("feedback", () => {
  beforeEach(() => {
    resetSoundPreference();
    globalThis.localStorage.clear();
    Reflect.deleteProperty(globalThis, "AudioContext");
    Reflect.deleteProperty(globalThis.navigator, "vibrate");
    mockReducedMotion(false);
  });

  it("stays silent until the player asks for sound", () => {
    const vibrate = installVibration();
    const { oscillators } = installAudioContext();

    playFeedback("roll");

    expect(oscillators).toHaveLength(0);
    expect(vibrate).not.toHaveBeenCalled();
    expect(isSoundEnabled()).toBe(false);
  });

  it("plays every note of a tone and its haptic once sound is on", () => {
    const vibrate = installVibration();
    const { frequencies, oscillators } = installAudioContext();
    setSoundEnabled(true);

    playFeedback("roll");

    // roll is two notes, 300 Hz then 360 Hz, with an 8 ms buzz.
    expect(frequencies).toEqual([300, 360]);
    expect(oscillators).toHaveLength(2);
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it("persists the choice and tells every listener", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSound(listener);

    setSoundEnabled(true);
    expect(globalThis.localStorage.getItem("roundhouse:sound")).toBe("on");
    expect(isSoundEnabled()).toBe(true);

    setSoundEnabled(false);
    expect(globalThis.localStorage.getItem("roundhouse:sound")).toBe("off");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setSoundEnabled(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("plays nothing when the player asked for reduced motion", () => {
    const vibrate = installVibration();
    const { oscillators } = installAudioContext();
    setSoundEnabled(true);
    mockReducedMotion(true);

    playFeedback("win");

    expect(oscillators).toHaveLength(0);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("still buzzes when the environment has no audio context", () => {
    const vibrate = installVibration();
    setSoundEnabled(true);

    // jsdom has no AudioContext; a silent tone must not swallow the haptic.
    expect(() => playFeedback("score")).not.toThrow();
    expect(vibrate).toHaveBeenCalledWith(12);
  });

  it("exposes the same behaviour through the object a view imports", () => {
    expect(feedback.isEnabled()).toBe(false);
    feedback.setEnabled(true);
    expect(feedback.isEnabled()).toBe(true);
    expect(typeof feedback.play).toBe("function");
  });
});
