// Which page of the Home and Chat pager is showing. Anything can switch pages (the Ask Ano box on Home,
// the back chevron in Chat, a tap on a locked canvas); the pager screen listens
// and scrolls, and reports back through `setPage` when a swipe settles. It holds no React state of
// its own, so a call made before the pager mounted (a deep link to /chat) is still honoured.
export type Page = 'home' | 'chat';

let page: Page = 'home';
const listeners = new Set<() => void>();

export function getPage(): Page {
  return page;
}

export function setPage(next: Page): void {
  if (next === page) return;
  page = next;
  for (const l of listeners) l();
}

export function showChat(): void {
  setPage('chat');
}

export function showHome(): void {
  setPage('home');
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// A one-shot request to open the Chat sidebar (the sidebar button on Home). Chat consumes it when it
// mounts or when the request arrives; it is not state, so a request nobody took is taken once.
let sidebarRequested = false;
const sidebarListeners = new Set<() => void>();

export function requestSidebar(): void {
  sidebarRequested = true;
  for (const l of sidebarListeners) l();
}

/** True once per request. */
export function takeSidebarRequest(): boolean {
  const was = sidebarRequested;
  sidebarRequested = false;
  return was;
}

export function subscribeSidebarRequest(listener: () => void): () => void {
  sidebarListeners.add(listener);
  return () => {
    sidebarListeners.delete(listener);
  };
}

// While the Chat sidebar is open the pager must not scroll: the same sideways swipe that closes the
// sidebar would otherwise drag Home in underneath it.
let locked = false;
const lockListeners = new Set<() => void>();

export function setPagerLocked(next: boolean): void {
  if (next === locked) return;
  locked = next;
  for (const l of lockListeners) l();
}

export function isPagerLocked(): boolean {
  return locked;
}

export function subscribePagerLock(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => {
    lockListeners.delete(listener);
  };
}
