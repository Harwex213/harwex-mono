import { h } from 'preact';
import { Button as BaseButton } from '@base-ui/react/button';
import './button.css';

function Button(props) {
  const { className, children, ...rest } = props;

  return h(
    BaseButton,
    {
      className: ['button', className].filter(Boolean).join(' '),
      ...rest,
    },
    children,
  );
}

export { Button };
