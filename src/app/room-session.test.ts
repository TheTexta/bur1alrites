import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera } from "three";
import { createRoomSession } from "./room-session";
import { FLOOR_Y, SCREEN_Z } from "./scene-layout";

function fixture() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    pointerLockElement: null as EventTarget | null,
    exitPointerLock: vi.fn(() => {
      document.pointerLockElement = null;
      document.dispatchEvent(new Event("pointerlockchange"));
    }),
  });
  const canvas = Object.assign(new EventTarget(), {
    requestPointerLock: vi.fn(() => {
      document.pointerLockElement = canvas;
      document.dispatchEvent(new Event("pointerlockchange"));
    }),
  });
  const visible = vi.fn();
  const walking = vi.fn();
  const session = createRoomSession(visible);
  const disconnect = session.connect({ window, document } as unknown as { window: Window; document: Document }, walking);
  const camera = new PerspectiveCamera();
  camera.position.set(0, 3, SCREEN_Z + 30);
  const bind = () => session.bind(canvas as unknown as HTMLCanvasElement, camera);
  const key = (type: string, code: string) => window.dispatchEvent(Object.assign(new Event(type), { code }));
  const move = (movementX: number, movementY: number) => document.dispatchEvent(Object.assign(new Event("mousemove"), { movementX, movementY }));
  return { window, document, canvas, session, visible, walking, camera, bind, key, move, disconnect };
}

describe("room session ownership", () => {
  it("opens, walks without React state, unlocks/recenters, closes and reopens cleanly", () => {
    const f = fixture();
    f.bind();
    f.session.open();
    expect(f.visible).toHaveBeenLastCalledWith(true);
    f.canvas.dispatchEvent(new Event("click"));
    expect(f.walking).toHaveBeenLastCalledWith(true);
    expect(f.session.position.toArray()).toEqual(f.camera.position.toArray());
    f.key("keydown", "KeyW");
    expect(f.session.walk(f.camera, 0.5)).toBe(true);
    expect(f.camera.position.z).toBe(SCREEN_Z + 22);
    expect(f.camera.position.y).toBe(FLOOR_Y + 5);
    f.move(10, 10000);
    expect(f.session.look.yaw).toBeCloseTo(-0.022);
    expect(f.session.look.pitch).toBe(-1.4);
    f.document.exitPointerLock();
    expect(f.session.keys.forward).toBe(false);
    expect(f.session.look.recentering).toBe(true);
    expect(f.session.walk(f.camera, 1)).toBe(false);
    f.session.close();
    expect(f.session.look).toEqual({ yaw: 0, pitch: 0, locked: false, recentering: false });
    expect(f.visible).toHaveBeenLastCalledWith(false);
    f.session.open();
    expect(f.session.position.toArray()).toEqual([0, 0, 0]);
    expect(f.session.keys.forward).toBe(false);
    f.session.dispose();
  });

  it("retains walk state through a rig remount, but never shares it with another owner", () => {
    const f = fixture();
    const release = f.bind();
    f.session.open();
    f.canvas.dispatchEvent(new Event("click"));
    f.key("keydown", "KeyD");
    f.session.walk(f.camera, 0.25);
    const position = f.session.position.clone();
    release();
    f.bind();
    release(); // Stale cleanup cannot detach the replacement binding.
    expect(f.session.look.locked).toBe(true);
    expect(f.session.keys.right).toBe(true);
    expect(f.session.position.equals(position)).toBe(true);
    const other = createRoomSession(() => {});
    expect(other.look.locked).toBe(false);
    expect(other.keys.right).toBe(false);
    expect(other.position.toArray()).toEqual([0, 0, 0]);
    f.session.dispose();
  });

  it("clears stuck keys on blur and releases owned lock/listeners/visibility on open-room disposal", () => {
    const f = fixture();
    f.bind();
    f.session.open();
    f.canvas.dispatchEvent(new Event("click"));
    f.key("keydown", "ArrowUp");
    f.window.dispatchEvent(new Event("blur"));
    expect(f.session.keys.forward).toBe(false);
    f.key("keydown", "KeyA");
    f.session.dispose();
    expect(f.document.exitPointerLock).toHaveBeenCalledOnce();
    expect(f.visible).toHaveBeenLastCalledWith(false);
    expect(f.walking).toHaveBeenLastCalledWith(false);
    f.key("keydown", "KeyW");
    f.move(100, 100);
    f.canvas.dispatchEvent(new Event("click"));
    expect(Object.values(f.session.keys).some(Boolean)).toBe(false);
    expect(f.session.look.yaw).toBe(0);
    expect(f.canvas.requestPointerLock).toHaveBeenCalledOnce();
    f.disconnect(); // Idempotent React owner cleanup.
  });

  it("does not unlock someone else's pointer and rejects late locks after closing", () => {
    const f = fixture();
    f.bind();
    f.session.open();
    f.document.pointerLockElement = new EventTarget();
    f.session.close();
    expect(f.document.exitPointerLock).not.toHaveBeenCalled();
    f.document.pointerLockElement = f.canvas;
    f.document.dispatchEvent(new Event("pointerlockchange"));
    expect(f.document.pointerLockElement).toBe(null);
    expect(f.session.look.locked).toBe(false);
    f.session.dispose();
  });

  it("releases desktop controls on a mobile/fallback handoff without unpausing the covered hero", () => {
    const f = fixture();
    f.bind();
    f.session.open();
    f.canvas.dispatchEvent(new Event("click"));
    f.key("keydown", "KeyW");
    f.session.releaseControls();
    expect(f.session.look.locked).toBe(false);
    expect(f.session.look.recentering).toBe(true);
    expect(f.session.keys.forward).toBe(false);
    expect(f.visible).toHaveBeenLastCalledWith(true);
    f.session.finishRecentering();
    expect(f.session.look.recentering).toBe(false);
    f.session.dispose();
  });

  it("releases a pending pointer-lock request that resolves after disposal", async () => {
    const f = fixture();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    f.canvas.requestPointerLock.mockImplementation(() => pending as unknown as void);
    f.bind();
    f.session.open();
    f.canvas.dispatchEvent(new Event("click"));
    f.session.dispose();
    f.document.pointerLockElement = f.canvas;
    finish();
    await pending;
    expect(f.document.pointerLockElement).toBe(null);
    expect(f.visible).toHaveBeenLastCalledWith(false);
  });

  it.each(["before", "after"])("rejects a handoff's late lock event %s request resolution, then permits desktop activation", async timing => {
    const f = fixture();
    f.bind();
    f.session.open();
    f.canvas.dispatchEvent(new Event("click"));
    f.key("keydown", "KeyW");
    f.session.walk(f.camera, 0.25);
    f.move(10, 20);
    f.document.exitPointerLock();

    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const acquire = f.canvas.requestPointerLock.getMockImplementation()!;
    f.canvas.requestPointerLock.mockImplementation(() => pending as unknown as void);
    f.canvas.dispatchEvent(new Event("click"));
    f.session.releaseControls();
    const position = f.session.position.clone();
    const look = { ...f.session.look };
    f.camera.position.set(9, 8, 7); // A stale acquisition must not seed a new walk pose.
    f.walking.mockClear();
    f.canvas.dispatchEvent(new Event("click"));
    expect(f.canvas.requestPointerLock).toHaveBeenCalledTimes(2);
    f.key("keydown", "KeyW");
    expect(f.session.keys.forward).toBe(false);

    // Re-enabling alone must not validate the previous desktop generation's request.
    f.bind();
    if (timing === "after") {
      f.document.pointerLockElement = f.canvas;
      finish();
      await pending;
      expect(f.document.pointerLockElement).toBe(null);
    }
    f.document.pointerLockElement = f.canvas;
    f.document.dispatchEvent(new Event("pointerlockchange"));
    f.move(100, 100);
    expect(f.document.pointerLockElement).toBe(null);
    expect(f.session.position.equals(position)).toBe(true);
    expect(f.session.look).toEqual(look);
    expect(f.walking).not.toHaveBeenCalledWith(true);
    expect(f.visible).toHaveBeenLastCalledWith(true);

    f.canvas.requestPointerLock.mockImplementation(acquire);
    f.canvas.dispatchEvent(new Event("click"));
    expect(f.session.look.locked).toBe(true);
    expect(f.session.position.toArray()).toEqual([9, 8, 7]);
    if (timing === "before") { finish(); await pending; }
    // Completion of the obsolete request cannot release this newer valid lock.
    expect(f.document.pointerLockElement).toBe(f.canvas);
    expect(f.walking).toHaveBeenLastCalledWith(true);
    f.session.dispose();
  });
});
