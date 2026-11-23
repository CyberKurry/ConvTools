import type { ReactElement } from 'react';
import styles from './Progress.module.css';

export function Progress(props: { value: number; label: string }): ReactElement {
  const percentage = Math.min(100, Math.max(0, props.value));
  return (
    <div className={styles.wrapper}>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <span className={styles.bar} style={{ width: `${percentage}%` }} />
      </div>
      <span className={styles.percentage}>{percentage}%</span>
    </div>
  );
}
