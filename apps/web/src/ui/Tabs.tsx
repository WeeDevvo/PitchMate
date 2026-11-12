import { useRef, type KeyboardEvent } from 'react';
import { Badge } from './Badge';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import { nextRovingIndex } from './roving';
import './Tabs.css';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: IconName;
  disabled?: boolean;
}

export interface TabsProps {
  /** Names the tab list for assistive technology. */
  label: string;
  tabs: readonly TabItem[];
  active: string;
  onChange: (id: string) => void;
  /** The id of the panel each tab controls, when the panels are rendered. */
  panelId?: (id: string) => string;
}

/** Underlined tabs: one tab stop, arrow keys and Home/End move and select. */
export function Tabs({ label, tabs, active, onChange, panelId }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRovingIndex(
      event.key,
      index,
      tabs.map((tab) => !tab.disabled),
    );
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(tabs[next].id);
  };

  return (
    <div className="pm-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId?.(tab.id)}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            className={cx('pm-tab', selected && 'is-active')}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.icon && <Icon name={tab.icon} size={18} />}
            {tab.label}
            {tab.count !== undefined && <Badge>{tab.count}</Badge>}
          </button>
        );
      })}
    </div>
  );
}

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  label: string;
  options: readonly SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  block?: boolean;
}

/** Two to five mutually exclusive options, as a radio group with one tab stop. */
export function SegmentedControl({ label, options, value, onChange, block }: SegmentedControlProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRovingIndex(
      event.key,
      index,
      options.map(() => true),
    );
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  return (
    <div className={cx('pm-seg', block && 'pm-seg--block')} role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={cx('pm-seg__opt', checked && 'is-active')}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
