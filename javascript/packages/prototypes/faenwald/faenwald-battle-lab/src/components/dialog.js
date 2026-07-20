import { h } from 'preact';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import './dialog.css';

function Dialog(props) {
  const { trigger, title, description, children } = props;

  return h(
    BaseDialog.Root,
    null,
    h(BaseDialog.Trigger, { className: 'button dialog-trigger' }, trigger),
    h(
      BaseDialog.Portal,
      null,
      h(BaseDialog.Backdrop, { className: 'dialog-backdrop' }),
      h(
        BaseDialog.Viewport,
        { className: 'dialog-viewport' },
        h(
          BaseDialog.Popup,
          { className: 'dialog-popup' },
          h(BaseDialog.Title, { className: 'dialog-title' }, title),
          description
            ? h(BaseDialog.Description, { className: 'dialog-description' }, description)
            : null,
          children,
          h(BaseDialog.Close, { className: 'button dialog-close' }, 'Close'),
        ),
      ),
    ),
  );
}

export { Dialog };
