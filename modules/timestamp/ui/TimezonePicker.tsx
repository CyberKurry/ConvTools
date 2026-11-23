import { memo, useMemo, useState, type ReactElement } from 'react';
import { IconGlobe, IconSearch } from '../../../core/ui/icons';
import { listTimezones } from '../core/timezones';
import styles from './TimestampSurface.module.css';

export const TimezonePicker = memo(function TimezonePicker(props: {
  value: string;
  browserZone: string;
  label: string;
  searchLabel: string;
  onChange: (zone: string) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const zones = useMemo(() => listTimezones(props.browserZone), [props.browserZone]);
  // The selected zone stays in the list even when the search filter excludes
  // it: otherwise the controlled select would display the first filtered
  // option while the state (and every conversion) kept the old zone.
  const filtered = useMemo(
    () => [...new Set([props.value, ...zones.filter((zone) => zone.toLowerCase().includes(query.toLowerCase()))])],
    [props.value, zones, query],
  );

  return (
    <div className={styles.tzPickerWrapper}>
      <div className={styles.tzHeader}>
        <span className={styles.tzHeaderTitle}>
          <IconGlobe size={13} className={styles.tzIcon} />
          {props.label}
        </span>
        <span className={styles.browserZoneBadge}>{props.browserZone}</span>
      </div>

      <div className={styles.tzGrid}>
        <label className={styles.tzSearchField}>
          <span className={styles.tzFieldLabel}>{props.searchLabel}</span>
          <div className={styles.tzSearchControl}>
            <IconSearch size={12} className={styles.tzSearchIcon} />
            <input
              className={styles.tzInput}
              aria-label={props.searchLabel}
              placeholder={props.searchLabel}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </label>

        <label className={styles.tzSelectField}>
          <span className={styles.tzFieldLabel}>{props.label}</span>
          <select
            className={styles.tzSelect}
            aria-label={props.label}
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
          >
            {filtered.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
});
