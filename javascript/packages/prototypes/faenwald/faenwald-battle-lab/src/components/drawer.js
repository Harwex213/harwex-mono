import { h } from 'preact';
import { Drawer as BaseDrawer } from '@base-ui/react/drawer';
import './drawer.css';

function Drawer(props) {
  const { trigger, title, children } = props;

  return h(
    BaseDrawer.Root,
    { swipeDirection: 'down' },
    h(BaseDrawer.Trigger, { className: 'button drawer-trigger' }, trigger),
    h(
      BaseDrawer.Portal,
      null,
      h(BaseDrawer.Backdrop, { className: 'drawer-backdrop' }),
      h(
        BaseDrawer.Viewport,
        { className: 'drawer-viewport' },
        h(
          BaseDrawer.Popup,
          { className: 'drawer-popup' },
          h(
            BaseDrawer.Content,
            { className: 'drawer-content' },
            h(BaseDrawer.Title, { className: 'drawer-title' }, title),
            children,
            h(BaseDrawer.Close, { className: 'button drawer-close' }, 'Close'),
          ),
        ),
      ),
    ),
  );
}

export { Drawer };
