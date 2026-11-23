import type { ReactElement } from 'react';
import type { InstantParts } from '../core/types';
import { Button } from '../../../core/ui/Button';
import { IconAlertTriangle } from '../../../core/ui/icons';
import styles from './TimestampSurface.module.css';

export function AmbiguityChoice(props: {
  prompt: string;
  earlierLabel: string;
  laterLabel: string;
  cancelLabel: string;
  earlier: InstantParts;
  later: InstantParts;
  onChoose: (choice: InstantParts) => void;
  onCancel: () => void;
}): ReactElement {
  return (
    <div role="group" aria-label={props.prompt} className={styles.ambiguityCard}>
      <div className={styles.ambiguityHeader}>
        <IconAlertTriangle size={14} className={styles.ambiguityIcon} />
        <p className={styles.ambiguityPrompt}>{props.prompt}</p>
      </div>
      <div className={styles.ambiguityActions}>
        <Button size="sm" variant="secondary" onClick={() => props.onChoose(props.earlier)}>
          {props.earlierLabel}: {props.earlier.zoned}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => props.onChoose(props.later)}>
          {props.laterLabel}: {props.later.zoned}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          {props.cancelLabel}
        </Button>
      </div>
    </div>
  );
}
