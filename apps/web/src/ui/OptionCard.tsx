import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './OptionCard.css';

export interface OptionCardProps {
  /** The radio group's name, shared by every card in it. */
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  /** Names the radio. */
  title: string;
  /** Read as the radio's description. */
  description?: ReactNode;
  /** An icon in the corner tile, or any leading content (a date box) in its place. */
  icon?: IconName;
  leading?: ReactNode;
  badge?: ReactNode;
  /** The tighter layout, for picking among many (candidate days). */
  compact?: boolean;
}

/**
 * A radio card for picking one option: a real radio named by the title and
 * described by the description, drawn as a card. Selected is the Pitch Green
 * border on the accent-subtle ground plus a ticked radio, so it is not colour
 * alone. Put the cards in a fieldset (or `role="radiogroup"`) with a legend.
 */
export function OptionCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  icon,
  leading,
  badge,
  compact,
}: OptionCardProps) {
  const descriptionId = useId();

  return (
    <label className={cx('pm-option', checked && 'is-selected', compact && 'pm-option--compact')}>
      <input
        type="radio"
        className="pm-option__input"
        name={name}
        value={value}
        checked={checked}
        aria-label={title}
        aria-describedby={description === undefined ? undefined : descriptionId}
        onChange={() => onChange(value)}
      />
      <span className="pm-option__top">
        {leading ?? (icon && (
          <span className="pm-option__icon" aria-hidden="true">
            <Icon name={icon} size={22} />
          </span>
        ))}
        <span className="pm-option__radio" aria-hidden="true">
          {checked && <Icon name="check" size={14} strokeWidth={3} />}
        </span>
      </span>
      <span className="pm-option__title" aria-hidden="true">
        {title}
      </span>
      {description !== undefined && (
        <span id={descriptionId} className="pm-option__desc">
          {description}
        </span>
      )}
      {badge}
    </label>
  );
}
