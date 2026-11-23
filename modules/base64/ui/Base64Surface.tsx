import type { ReactElement } from 'react';
import type { ModuleContext } from '../../../core/module-sdk/context';
import { FilePanel } from './FilePanel';
import { TextPanel } from './TextPanel';
import styles from './Base64Surface.module.css';

export interface Base64SurfaceProps {
  readonly context: ModuleContext;
  readonly mode: 'popup' | 'workbench';
}

export function Base64Surface(props: Base64SurfaceProps): ReactElement {
  return (
    <div className={styles.root}>
      <TextPanel context={props.context} compact={props.mode === 'popup'} />
      {props.mode === 'workbench' ? <FilePanel context={props.context} /> : null}
    </div>
  );
}