// A gallery owns this registry; slugs, not catalogue positions, identify layout targets.
export function createGalleryTargetRegistry() {
  const targets = new Map<string, Map<symbol, HTMLElement>>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    register(slug: string, element: HTMLElement) {
      const token = Symbol(slug);
      let candidates = targets.get(slug);
      if (!candidates) targets.set(slug, candidates = new Map());
      candidates.set(token, element);
      notify();
      return () => {
        if (!candidates.delete(token)) return;
        if (candidates.size === 0 && targets.get(slug) === candidates) targets.delete(slug);
        notify();
      };
    },
    get(slug: string) {
      // Responsive copies may coexist. The newest connected, laid-out target wins.
      let selected: HTMLElement | null = null;
      for (const element of targets.get(slug)?.values() ?? []) {
        if (!element.isConnected) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) selected = element;
      }
      return selected;
    },
    entries: () => Array.from(targets, ([slug, candidates]) =>
      Array.from(candidates.values(), element => ({ slug, element }))).flat(),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type GalleryTargetRegistry = ReturnType<typeof createGalleryTargetRegistry>;

// Ownership and stale observer deliveries are resolved here, before touching the preview pool.
export function observeGalleryTargets(
  registry: GalleryTargetRegistry,
  slugs: ReadonlySet<string>,
  createObserver: (callback: IntersectionObserverCallback) => IntersectionObserver,
  onVisible: (slug: string, visible: boolean) => void,
) {
  const observed = new Map<Element, string>();
  const intersecting = new Set<Element>();
  const visibility = new Map<string, boolean>();
  let disposed = false;
  const publish = () => {
    for (const slug of slugs) {
      const target = registry.get(slug);
      const visible = target !== null && intersecting.has(target);
      if (visibility.get(slug) !== visible) {
        visibility.set(slug, visible);
        onVisible(slug, visible);
      }
    }
  };
  const observer = createObserver(entries => {
    if (disposed) return;
    for (const entry of entries) {
      if (!observed.has(entry.target)) continue;
      if (entry.isIntersecting) intersecting.add(entry.target);
      else intersecting.delete(entry.target);
    }
    publish();
  });
  const sync = () => {
    const current = new Map(registry.entries()
      .filter(({ slug }) => slugs.has(slug))
      .map(({ slug, element }) => [element, slug]));
    for (const element of observed.keys()) {
      if (current.has(element as HTMLElement)) continue;
      observer.unobserve(element);
      observed.delete(element);
      intersecting.delete(element);
    }
    for (const [element, slug] of current) {
      if (observed.has(element)) continue;
      observed.set(element, slug);
      observer.observe(element);
    }
    publish();
  };
  const unsubscribe = registry.subscribe(sync);
  sync();
  return () => {
    disposed = true;
    unsubscribe();
    observed.clear();
    intersecting.clear();
    observer.disconnect();
  };
}
