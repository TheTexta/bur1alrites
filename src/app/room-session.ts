import { Euler, MathUtils, Vector3, type PerspectiveCamera } from "three";
import { FLOOR_SIZE, FLOOR_Y, SCREEN_Z } from "./scene-layout";

const WALK_KEYS: Record<string, "forward" | "back" | "left" | "right"> = {
  KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
};

// Owned above the Suspense-driven rig. Only frame consumers mutate position/recentering.
export function createRoomSession(setOpen: (open: boolean) => void) {
  const keys = { forward: false, back: false, left: false, right: false };
  const look = { yaw: 0, pitch: 0, locked: false, recentering: false };
  const position = new Vector3();
  const heading = new Vector3();
  const strafe = new Vector3();
  const motion = new Vector3();
  let active = false;
  let controlsEnabled = false;
  let controlGeneration = 0;
  let requestedGeneration = -1;
  let canvas: HTMLCanvasElement | null = null;
  let camera: PerspectiveCamera | null = null;
  let browser: { window: Window; document: Document } | null = null;
  let onWalking: (walking: boolean) => void = () => {};
  let disconnect = () => {};
  let unbind = () => {};

  const resetKeys = () => {
    keys.forward = keys.back = keys.left = keys.right = false;
  };
  const stopControls = () => {
    controlGeneration += 1;
    resetKeys();
    if (canvas && browser?.document.pointerLockElement === canvas) browser.document.exitPointerLock();
    if (look.locked) look.recentering = true;
    look.locked = false;
    onWalking(false);
  };
  const releaseControls = () => {
    controlsEnabled = false;
    stopControls();
  };
  const close = () => {
    active = false;
    stopControls();
    look.yaw = look.pitch = 0;
    look.locked = look.recentering = false;
    position.set(0, 0, 0);
    setOpen(false);
  };

  return {
    keys, look, position,
    finishRecentering() { look.recentering = false; },
    walk(camera: PerspectiveCamera, delta: number) {
      if (!look.locked) return false;
      const { yaw, pitch } = look;
      heading.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      strafe.set(Math.cos(yaw), 0, -Math.sin(yaw));
      motion.set(0, 0, 0);
      if (keys.forward) motion.add(heading);
      if (keys.back) motion.sub(heading);
      if (keys.right) motion.add(strafe);
      if (keys.left) motion.sub(strafe);
      if (motion.lengthSq() > 0) position.addScaledVector(motion.normalize(), 16 * delta);
      position.x = MathUtils.clamp(position.x, -(FLOOR_SIZE / 2 - 14), FLOOR_SIZE / 2 - 14);
      position.z = MathUtils.clamp(position.z, SCREEN_Z + 1, SCREEN_Z + 72);
      position.y = FLOOR_Y + 5;
      camera.position.copy(position);
      camera.rotation.set(pitch, yaw, 0, "YXZ");
      return true;
    },
    open() {
      close();
      active = true;
      setOpen(true);
    },
    close,
    releaseControls,
    connect(host: { window: Window; document: Document }, walking: (value: boolean) => void) {
      disconnect();
      browser = host;
      onWalking = walking;
      const setKey = (event: KeyboardEvent, pressed: boolean) => {
        const action = WALK_KEYS[event.code];
        if (active && controlsEnabled && action) keys[action] = pressed;
      };
      const down = (event: KeyboardEvent) => setKey(event, true);
      const up = (event: KeyboardEvent) => setKey(event, false);
      const move = (event: MouseEvent) => {
        if (!active || !controlsEnabled || !look.locked || !canvas || host.document.pointerLockElement !== canvas) return;
        look.yaw -= event.movementX * 0.0022;
        look.pitch = MathUtils.clamp(look.pitch - event.movementY * 0.0022, -1.4, 1.4);
      };
      const lock = () => {
        const eligible = active && controlsEnabled && requestedGeneration === controlGeneration;
        if (!eligible && canvas && host.document.pointerLockElement === canvas) {
          host.document.exitPointerLock();
          return;
        }
        const locked = eligible && canvas !== null && host.document.pointerLockElement === canvas;
        if (!locked) {
          resetKeys();
          if (look.locked) look.recentering = true;
        } else if (!look.locked && camera) {
          position.copy(camera.position);
          const euler = new Euler().setFromQuaternion(camera.quaternion, "YXZ");
          look.yaw = euler.y;
          look.pitch = euler.x;
        }
        look.locked = locked;
        onWalking(locked);
      };
      host.window.addEventListener("keydown", down);
      host.window.addEventListener("keyup", up);
      host.window.addEventListener("blur", resetKeys);
      host.document.addEventListener("mousemove", move);
      host.document.addEventListener("pointerlockchange", lock);
      disconnect = () => {
        host.window.removeEventListener("keydown", down);
        host.window.removeEventListener("keyup", up);
        host.window.removeEventListener("blur", resetKeys);
        host.document.removeEventListener("mousemove", move);
        host.document.removeEventListener("pointerlockchange", lock);
        browser = null;
        onWalking = () => {};
      };
      return () => { close(); disconnect(); };
    },
    bind(element: HTMLCanvasElement, nextCamera: PerspectiveCamera) {
      unbind();
      controlsEnabled = true;
      if (canvas !== element) {
        controlGeneration += 1;
        if (canvas && browser?.document.pointerLockElement === canvas) browser.document.exitPointerLock();
      }
      canvas = element;
      camera = nextCamera;
      const click = () => {
        if (!active || !controlsEnabled || browser?.document.pointerLockElement === element) return;
        const ownerDocument = browser?.document;
        const generation = controlGeneration;
        requestedGeneration = generation;
        // Handoffs invalidate pending acquisitions even while the room remains open.
        Promise.resolve(element.requestPointerLock() as unknown).then(() => {
          const stale = !active || !controlsEnabled || generation !== controlGeneration;
          const newerRequest = requestedGeneration !== generation;
          if (stale && !newerRequest && ownerDocument?.pointerLockElement === element) ownerDocument.exitPointerLock();
        }).catch(() => {});
      };
      element.addEventListener("click", click);
      let bound = true;
      const release = () => {
        if (!bound) return;
        bound = false;
        element.removeEventListener("click", click);
        // Retain the owned canvas/pose across internal rig remounts; close owns unlocking.
      };
      unbind = release;
      return release;
    },
    dispose() {
      close();
      unbind();
      disconnect();
      canvas = null;
      camera = null;
    },
  };
}

export type RoomSession = ReturnType<typeof createRoomSession>;
