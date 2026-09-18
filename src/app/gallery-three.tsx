"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import type { RenderMode } from "@/lib/browser-render-mode";
import { attachHlsStream, type HlsStreamController } from "@/lib/hls-stream";
import { openVideoRoom } from "./video-room";
import { HERO_EYE_Y, SCREEN_Z } from "./scene-layout";
import { useRenderingEnabled } from "./scene-utils";
import { VideoThumb } from "./video-thumb";

const GALLERY_HOVER_EVENT = "portfolio:gallery-hover";
// Fixed in the room just in front of the screen's maximum displacement. Unlike a billboard tied
// to the camera, this lets pointer drift and the final camera tilt create real scene parallax.
const GALLERY_WORLD_Z = SCREEN_Z + 9;
const LABEL_DEPTH = 0.18;
const LOAD_MARGIN = 1;
const RELEASE_MARGIN = 2.5;
const REVEAL_EASE = 24;

export type GallerySceneItem = {
  slug: string;
  previewUrl: string;
  manifestUrl: string | null;
  width: number;
  height: number;
  title: string;
  client: string;
  type: string;
  year: string;
};

type GalleryHoverDetail = {
  slug: string;
  active: boolean;
};

type GalleryPlayback = {
  hoveredSlug: string | null;
  loadingSlug: string | null;
  videoSlug: string | null;
  videoTexture: THREE.VideoTexture | null;
};

type GalleryTargets = Map<string, THREE.Mesh>;

function setGalleryHover(slug: string, active: boolean) {
  window.dispatchEvent(
    new CustomEvent<GalleryHoverDetail>(GALLERY_HOVER_EVENT, {
      detail: { slug, active },
    }),
  );
}

function GalleryMetadata({ item }: { item: GallerySceneItem }) {
  return (
    <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 px-[5px] pb-[5px] leading-[1.35] text-white mix-blend-difference">
      <span className="flex min-w-0 flex-col">
        <span className="font-bold">{item.title}</span>
        <span>{item.client}</span>
      </span>
      <span className="flex min-w-0 flex-col items-end text-right">
        <span>{item.type}</span>
        <span>{item.year}</span>
      </span>
    </span>
  );
}

export function GalleryMediaSlot({
  item,
  index,
  renderMode,
}: {
  item: GallerySceneItem;
  index: number;
  renderMode: RenderMode;
}) {
  const enabled = useRenderingEnabled();
  const label = `${item.title}, ${item.client}, ${item.type}, ${item.year}`;
  const style = { aspectRatio: `${item.width} / ${item.height}` };

  if (!enabled) {
    return (
      <>
        {item.manifestUrl ? (
          <VideoThumb
            manifestUrl={item.manifestUrl}
            posterUrl={item.previewUrl}
            width={item.width}
            height={item.height}
            label={label}
            renderMode={renderMode}
          />
        ) : (
          <span className="relative block min-h-[60px] w-full overflow-hidden bg-[#050505] grayscale invert transition-[filter] hover:grayscale-0 hover:invert-0 focus-within:grayscale-0 focus-within:invert-0 [&_img]:block [&_img]:h-auto [&_img]:w-full">
            <Image
              src={item.previewUrl}
              alt={label}
              width={item.width}
              height={item.height}
              quality={75}
              sizes="(max-width: 767px) 100vw, (max-width: 991px) 50vw, (max-width: 1279px) 33vw, 25vw"
              unoptimized
            />
          </span>
        )}
        <GalleryMetadata item={item} />
      </>
    );
  }

  const interactionProps = {
    "data-gallery-plane": index,
    onFocus: () => setGalleryHover(item.slug, true),
    onBlur: () => setGalleryHover(item.slug, false),
    style,
  };

  if (item.manifestUrl) {
    return (
      <button
        {...interactionProps}
        type="button"
        aria-label={`Open ${label}`}
        onClick={() => {
          setGalleryHover(item.slug, false);
          openVideoRoom({
            manifestUrl: item.manifestUrl!,
            posterUrl: item.previewUrl,
            label,
            width: item.width,
            height: item.height,
          });
        }}
        className="pointer-events-none block min-h-[60px] w-full appearance-none bg-transparent p-0 text-inherit outline-offset-2"
      />
    );
  }

  return (
    <span
      {...interactionProps}
      role="img"
      aria-label={label}
      className="pointer-events-none block min-h-[60px] w-full"
    />
  );
}

function GalleryVideoController({
  items,
  playbackRef,
  preferNative,
}: {
  items: GallerySceneItem[];
  playbackRef: React.RefObject<GalleryPlayback>;
  preferNative: boolean;
}) {
  useEffect(() => {
    const playback = playbackRef.current;
    const videos = new Map(
      items
        .filter((item) => item.manifestUrl)
        .map((item) => [item.slug, item.manifestUrl!]),
    );
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    // This texture and video element are shared by every card. Switching cards only changes the
    // HLS source, so the gallery never owns more than one video decoder or frame upload stream.
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.NoColorSpace;
    videoTexture.generateMipmaps = false;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    playback.videoTexture = videoTexture;

    let controller: HlsStreamController | null = null;
    let requestVersion = 0;
    let disposed = false;

    const clearVideo = () => {
      requestVersion += 1;
      playback.loadingSlug = null;
      playback.videoSlug = null;
      video.pause();
      controller?.destroy();
      controller = null;
      video.removeAttribute("src");
      video.load();
    };

    const markFirstFrame = () => {
      const slug = playback.loadingSlug;
      if (!slug || playback.hoveredSlug !== slug) return;

      if ("requestVideoFrameCallback" in video) {
        video.requestVideoFrameCallback(() => {
          if (playback.hoveredSlug === slug && playback.loadingSlug === slug) {
            playback.videoSlug = slug;
          }
        });
      } else {
        playback.videoSlug = slug;
      }
    };

    video.addEventListener("loadeddata", markFirstFrame);

    const activate = (slug: string) => {
      playback.hoveredSlug = slug;
      const manifestUrl = videos.get(slug);

      if (!manifestUrl) {
        clearVideo();
        playback.hoveredSlug = slug;
        return;
      }

      if (playback.loadingSlug === slug) return;

      clearVideo();
      playback.hoveredSlug = slug;
      playback.loadingSlug = slug;
      const version = requestVersion;

      // There is deliberately no hover debounce. The static poster remains assigned to the card
      // until loadeddata/requestVideoFrameCallback confirms that a real decoded frame is ready.
      void attachHlsStream(video, manifestUrl, {
        startLevel: 0,
        preferNative,
      }).then(
        (nextController) => {
          if (
            disposed ||
            version !== requestVersion ||
            playback.hoveredSlug !== slug
          ) {
            nextController.destroy();
            return;
          }

          controller = nextController;
          controller.startLoading();
          void video.play().catch(() => {});
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) markFirstFrame();
        },
        () => {
          if (version === requestVersion && playback.loadingSlug === slug) {
            playback.loadingSlug = null;
          }
        },
      );
    };

    const onHover = (event: Event) => {
      const { slug, active } = (event as CustomEvent<GalleryHoverDetail>).detail;

      if (active) {
        activate(slug);
      } else if (playback.hoveredSlug === slug) {
        playback.hoveredSlug = null;
        clearVideo();
      }
    };

    window.addEventListener(GALLERY_HOVER_EVENT, onHover);

    return () => {
      disposed = true;
      window.removeEventListener(GALLERY_HOVER_EVENT, onHover);
      video.removeEventListener("loadeddata", markFirstFrame);
      playback.hoveredSlug = null;
      clearVideo();
      playback.videoTexture = null;
      videoTexture.dispose();
    };
  }, [items, playbackRef, preferNative]);

  return null;
}

function GalleryPointerController({
  items,
  targetsRef,
}: {
  items: GallerySceneItem[];
  targetsRef: React.RefObject<GalleryTargets>;
}) {
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointerNdc = useMemo(() => new THREE.Vector2(), []);
  const pointerClientRef = useRef(new THREE.Vector2());
  const pointerActiveRef = useRef(false);
  const hoveredSlugRef = useRef<string | null>(null);
  const itemsBySlug = useMemo(
    () => new Map(items.map((item) => [item.slug, item])),
    [items],
  );

  const pick = (clientX: number, clientY: number) => {
    const bounds = domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;

    pointerNdc.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((clientY - bounds.top) / bounds.height) * 2,
    );
    raycaster.setFromCamera(pointerNdc, camera);

    const meshes: THREE.Mesh[] = [];
    targetsRef.current.forEach((mesh) => {
      if (!mesh.visible || !mesh.parent?.visible) return;
      mesh.updateWorldMatrix(true, false);
      meshes.push(mesh);
    });

    const hit = raycaster.intersectObjects(meshes, false)[0]?.object as
      | THREE.Mesh
      | undefined;
    const slug = hit?.userData.gallerySlug;
    return typeof slug === "string" ? itemsBySlug.get(slug) ?? null : null;
  };

  const updateHover = (item: GallerySceneItem | null) => {
    const nextSlug = item?.slug ?? null;
    const previousSlug = hoveredSlugRef.current;
    if (previousSlug === nextSlug) return;

    if (previousSlug) setGalleryHover(previousSlug, false);
    if (nextSlug) setGalleryHover(nextSlug, true);
    hoveredSlugRef.current = nextSlug;
    document.documentElement.style.cursor = item?.manifestUrl ? "pointer" : "";
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointerClientRef.current.set(event.clientX, event.clientY);
      pointerActiveRef.current = true;
    };
    const clearPointer = () => {
      pointerActiveRef.current = false;
      updateHover(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Once keyboard navigation starts, the native invisible buttons own focus/activation.
      if (event.key === "Tab") clearPointer();
    };
    const onClick = (event: MouseEvent) => {
      // detail=0 is a keyboard-generated button click and is handled by GalleryMediaSlot.
      if (event.detail === 0 || document.querySelector('[role="dialog"]')) return;
      const item = pick(event.clientX, event.clientY);
      if (!item?.manifestUrl) return;

      event.preventDefault();
      event.stopPropagation();
      updateHover(null);
      openVideoRoom({
        manifestUrl: item.manifestUrl,
        posterUrl: item.previewUrl,
        label: `${item.title}, ${item.client}, ${item.type}, ${item.year}`,
        width: item.width,
        height: item.height,
      });
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", clearPointer);
    window.addEventListener("blur", clearPointer);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", clearPointer);
      window.removeEventListener("blur", clearPointer);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", onClick, true);
      updateHover(null);
    };
  });

  useFrame(() => {
    if (!pointerActiveRef.current || document.querySelector('[role="dialog"]')) return;
    updateHover(pick(pointerClientRef.current.x, pointerClientRef.current.y));
  });

  return null;
}

const galleryVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const galleryFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uReveal;
  varying vec2 vUv;

  #include <common>

  void main() {
    vec4 texel = texture2D(uTexture, vUv);
    float grayscale = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 restingColor = vec3(1.0 - grayscale);
    vec3 displayColor = mix(restingColor, texel.rgb, uReveal);

    // Gallery source textures deliberately use NoColorSpace so both static images and the shared
    // VideoTexture follow this identical decode path without recompiling on every hover swap.
    gl_FragColor = sRGBTransferEOTF(vec4(displayColor, texel.a));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const galleryLabelFragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uLabels;
  uniform float uReveal;
  varying vec2 vUv;

  #include <common>

  void main() {
    vec4 label = texture2D(uLabels, vUv);
    vec4 texel = texture2D(uTexture, vUv);
    float grayscale = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 restingColor = vec3(1.0 - grayscale);
    vec3 displayColor = mix(restingColor, texel.rgb, uReveal);

    // White text with CSS difference blending is exactly the inverse of the media below it.
    gl_FragColor = sRGBTransferEOTF(vec4(1.0 - displayColor, label.a));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createLabelTexture(item: GallerySceneItem, width: number, height: number) {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  // Keep the glyph mask crisp without allocating a second full-resolution card texture.
  const scale = Math.min(2, 512 / safeWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(Math.ceil(safeWidth * scale), 1);
  canvas.height = Math.max(Math.ceil(safeHeight * scale), 1);
  const context = canvas.getContext("2d");

  if (context) {
    context.scale(scale, scale);
    context.fillStyle = "white";
    context.textBaseline = "bottom";
    const fontFamily = '"Times New Roman", Times, serif';
    const fontSize = 13;
    const lineHeight = fontSize * 1.35;
    const bottom = safeHeight - 5;
    const horizontalPadding = 8;

    context.textAlign = "left";
    context.font = `bold ${fontSize}px ${fontFamily}`;
    context.fillText(item.title, horizontalPadding, bottom - lineHeight);
    context.font = `${fontSize}px ${fontFamily}`;
    context.fillText(item.client, horizontalPadding, bottom);

    context.textAlign = "right";
    context.fillText(item.type, safeWidth - horizontalPadding, bottom - lineHeight);
    context.fillText(item.year, safeWidth - horizontalPadding, bottom);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function GalleryPlane({
  item,
  index,
  geometry,
  loader,
  playbackRef,
  targetsRef,
}: {
  item: GallerySceneItem;
  index: number;
  geometry: THREE.PlaneGeometry;
  loader: THREE.TextureLoader;
  playbackRef: React.RefObject<GalleryPlayback>;
  targetsRef: React.RefObject<GalleryTargets>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const labelMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const posterRef = useRef<THREE.Texture | null>(null);
  const labelRef = useRef<THREE.CanvasTexture | null>(null);
  const labelSizeRef = useRef({ width: 0, height: 0 });
  const posterStateRef = useRef<"idle" | "loading" | "ready" | "failed">("idle");
  const loadVersionRef = useRef(0);
  const activeTextureRef = useRef<THREE.Texture | null>(null);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const uniforms = useMemo(
    () => ({
      uTexture: { value: null as THREE.Texture | null },
      uReveal: { value: 0 },
    }),
    [],
  );
  const labelUniforms = useMemo(
    () => ({
      uTexture: { value: null as THREE.Texture | null },
      uLabels: { value: null as THREE.Texture | null },
      uReveal: { value: 0 },
    }),
    [],
  );

  useEffect(() => {
    elementRef.current = document.querySelector<HTMLElement>(
      `[data-gallery-plane="${index}"]`,
    );
    const targets = targetsRef.current;
    const mesh = meshRef.current;
    if (mesh) targets.set(item.slug, mesh);

    return () => {
      targets.delete(item.slug);
      loadVersionRef.current += 1;
      posterRef.current?.dispose();
      posterRef.current = null;
      labelRef.current?.dispose();
      labelRef.current = null;
    };
  }, [index, item.slug, targetsRef]);

  const releasePoster = () => {
    loadVersionRef.current += 1;
    posterRef.current?.dispose();
    posterRef.current = null;
    labelRef.current?.dispose();
    labelRef.current = null;
    labelSizeRef.current = { width: 0, height: 0 };
    posterStateRef.current = "idle";
    const playback = playbackRef.current;
    if (activeTextureRef.current && activeTextureRef.current !== playback.videoTexture) {
      activeTextureRef.current = null;
      if (materialRef.current) materialRef.current.uniforms.uTexture.value = null;
    }
    if (labelMaterialRef.current) {
      labelMaterialRef.current.uniforms.uTexture.value = null;
      labelMaterialRef.current.uniforms.uLabels.value = null;
    }
  };

  const ensureLabel = (width: number, height: number) => {
    const previous = labelSizeRef.current;
    if (
      labelRef.current &&
      Math.abs(previous.width - width) < 1 &&
      Math.abs(previous.height - height) < 1
    ) {
      return;
    }

    labelRef.current?.dispose();
    labelRef.current = createLabelTexture(item, width, height);
    labelSizeRef.current = { width, height };
    if (labelMaterialRef.current) {
      labelMaterialRef.current.uniforms.uLabels.value = labelRef.current;
    }
  };

  const loadPoster = () => {
    if (posterStateRef.current !== "idle") return;
    posterStateRef.current = "loading";
    const version = ++loadVersionRef.current;

    loader.load(
      item.previewUrl,
      (texture) => {
        if (version !== loadVersionRef.current) {
          texture.dispose();
          return;
        }

        texture.colorSpace = THREE.NoColorSpace;
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        posterRef.current = texture;
        posterStateRef.current = "ready";
      },
      undefined,
      () => {
        if (version === loadVersionRef.current) posterStateRef.current = "failed";
      },
    );
  };

  useFrame((_, delta) => {
    const group = groupRef.current;
    const mesh = meshRef.current;
    const material = materialRef.current;
    const labelMaterial = labelMaterialRef.current;
    const element = elementRef.current;
    if (!group || !mesh || !material || !labelMaterial || !element) return;
    const playback = playbackRef.current;

    const rect = element.getBoundingClientRect();
    const inLoadRange =
      rect.bottom > -size.height * LOAD_MARGIN &&
      rect.top < size.height * (1 + LOAD_MARGIN);
    const outOfReleaseRange =
      rect.bottom < -size.height * RELEASE_MARGIN ||
      rect.top > size.height * (1 + RELEASE_MARGIN);
    const onScreen =
      rect.bottom > 0 &&
      rect.top < size.height &&
      rect.right > 0 &&
      rect.left < size.width;

    if (inLoadRange) loadPoster();
    else if (outOfReleaseRange && playback.hoveredSlug !== item.slug) releasePoster();
    if (inLoadRange) ensureLabel(rect.width, rect.height);

    const videoIsReady =
      playback.videoSlug === item.slug && playback.videoTexture !== null;
    const nextTexture = videoIsReady ? playback.videoTexture : posterRef.current;

    if (activeTextureRef.current !== nextTexture) {
      activeTextureRef.current = nextTexture;
      material.uniforms.uTexture.value = nextTexture;
      labelMaterial.uniforms.uTexture.value = nextTexture;
    }

    group.visible = onScreen && nextTexture !== null && labelRef.current !== null;
    if (!group.visible) return;

    const galleryDistance = Math.max(camera.position.z - GALLERY_WORLD_Z, camera.near);
    const viewportHeight =
      2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * galleryDistance;
    const viewportWidth = viewportHeight * camera.aspect;
    const ndcX = ((rect.left + rect.width / 2) / Math.max(size.width, 1)) * 2 - 1;
    const ndcY = 1 - ((rect.top + rect.height / 2) / Math.max(size.height, 1)) * 2;

    group.position.set(
      ndcX * viewportWidth / 2,
      HERO_EYE_Y + ndcY * viewportHeight / 2,
      GALLERY_WORLD_Z,
    );
    group.rotation.set(0, 0, 0);
    group.scale.set(
      rect.width / Math.max(size.width, 1) * viewportWidth,
      rect.height / Math.max(size.height, 1) * viewportHeight,
      1,
    );

    const reveal = THREE.MathUtils.damp(
      material.uniforms.uReveal.value,
      playback.hoveredSlug === item.slug ? 1 : 0,
      REVEAL_EASE,
      delta,
    );
    material.uniforms.uReveal.value = reveal;
    labelMaterial.uniforms.uReveal.value = reveal;
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        userData={{ gallerySlug: item.slug }}
        frustumCulled={false}
        renderOrder={10}
      >
        <shaderMaterial
          ref={materialRef}
          uniforms={uniforms}
          vertexShader={galleryVertexShader}
          fragmentShader={galleryFragmentShader}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh
        geometry={geometry}
        position={[0, 0, LABEL_DEPTH]}
        frustumCulled={false}
        renderOrder={11}
      >
        <shaderMaterial
          ref={labelMaterialRef}
          uniforms={labelUniforms}
          vertexShader={galleryVertexShader}
          fragmentShader={galleryLabelFragmentShader}
          side={THREE.DoubleSide}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export function GalleryInScene({
  items,
  preferNative,
}: {
  items: GallerySceneItem[];
  preferNative: boolean;
}) {
  const playbackRef = useRef<GalleryPlayback>({
    hoveredSlug: null,
    loadingSlug: null,
    videoSlug: null,
    videoTexture: null,
  });
  const targetsRef = useRef<GalleryTargets>(new Map());
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const loader = useMemo(() => {
    const nextLoader = new THREE.TextureLoader();
    nextLoader.setCrossOrigin("anonymous");
    return nextLoader;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <>
      <GalleryVideoController
        items={items}
        playbackRef={playbackRef}
        preferNative={preferNative}
      />
      {items.map((item, index) => (
        <GalleryPlane
          key={item.slug}
          item={item}
          index={index}
          geometry={geometry}
          loader={loader}
          playbackRef={playbackRef}
          targetsRef={targetsRef}
        />
      ))}
      <GalleryPointerController items={items} targetsRef={targetsRef} />
    </>
  );
}
