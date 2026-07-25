import { h } from 'preact';
import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import './combobox.css';

function Combobox(props) {
  const { items, label, placeholder, onValueChange } = props;

  return h(
    BaseCombobox.Root,
    { items, onValueChange },
    label ? h('label', { className: 'combobox-label' }, label) : null,
    h(
      'div',
      { className: 'combobox-control' },
      h(BaseCombobox.Input, { className: 'combobox-input', placeholder }),
      h(BaseCombobox.Trigger, { className: 'combobox-trigger' }, '▾'),
    ),
    h(
      BaseCombobox.Portal,
      null,
      h(
        BaseCombobox.Positioner,
        { className: 'combobox-positioner', sideOffset: 4 },
        h(
          BaseCombobox.Popup,
          { className: 'combobox-popup' },
          h(BaseCombobox.Empty, { className: 'combobox-empty' }, 'No results.'),
          h(
            BaseCombobox.List,
            { className: 'combobox-list' },
            (item) =>
              h(
                BaseCombobox.Item,
                { key: item, value: item, className: 'combobox-item' },
                h(BaseCombobox.ItemIndicator, { className: 'combobox-item-indicator' }, '✓'),
                item,
              ),
          ),
        ),
      ),
    ),
  );
}

export { Combobox };
