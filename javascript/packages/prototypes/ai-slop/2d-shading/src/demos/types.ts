// A demo owns everything it creates: its DOM inside the host, its pixi app, its
// ticker callbacks. The router keeps no handle on any of that beyond the teardown
// the mount returns, so switching pages can never leave a second render loop alive.
type Teardown = () => void;

type Mount = (host: HTMLElement) => Promise<Teardown>;

type Demo = {
  id: string;
  title: string;
  summary: string;
  // null = technique described in the nav but not implemented yet; the router
  // renders the summary instead of a canvas.
  mount: Mount | null;
};

export type { Demo, Mount, Teardown };
