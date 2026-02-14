import { useEffect, useState } from "react";

type GamepadState = {
  connected: boolean;
  buttons: boolean[];
  axes: number[];
  refresh: () => void;
};

export function useGamepad() {
  const [state, setState] = useState<GamepadState>({
    connected: false,
    buttons: [],
    axes: [],
    refresh: () => undefined
  });

  useEffect(() => {
    let frame: number | null = null;
    let active = true;

    const readGamepad = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gamepad = gamepads ? Array.from(gamepads).find((pad) => pad && pad.connected) : null;
      if (gamepad) {
        setState((prev) => ({
          ...prev,
          connected: true,
          buttons: gamepad.buttons.map((button) => button.pressed),
          axes: [...gamepad.axes]
        }));
        return;
      }
      setState((prev) => ({
        ...prev,
        connected: false,
        buttons: [],
        axes: []
      }));
    };

    const updateLoop = () => {
      if (!active) return;
      readGamepad();
      frame = window.requestAnimationFrame(updateLoop);
    };

    const handleConnected = () => {
      readGamepad();
    };

    const handleDisconnected = () => {
      setState((prev) => ({ ...prev, connected: false, buttons: [], axes: [] }));
    };

    window.addEventListener("gamepadconnected", handleConnected);
    window.addEventListener("gamepaddisconnected", handleDisconnected);
    window.addEventListener("focus", readGamepad);
    window.addEventListener("pointerdown", readGamepad);
    window.addEventListener("visibilitychange", readGamepad);

    updateLoop();

    setState((prev) => ({ ...prev, refresh: readGamepad }));

    return () => {
      window.removeEventListener("gamepadconnected", handleConnected);
      window.removeEventListener("gamepaddisconnected", handleDisconnected);
      window.removeEventListener("focus", readGamepad);
      window.removeEventListener("pointerdown", readGamepad);
      window.removeEventListener("visibilitychange", readGamepad);
      active = false;
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  return state;
}
