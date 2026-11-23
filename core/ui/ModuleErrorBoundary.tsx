import { Component, type ErrorInfo, type ReactNode } from 'react';
import { IconAlertTriangle, IconRefresh } from './icons';
import styles from './ModuleErrorBoundary.module.css';

export interface ModuleErrorBoundaryProps {
  readonly moduleId: string;
  readonly title: string;
  readonly retryLabel: string;
  readonly children: ReactNode;
  readonly onReset?: () => void;
}

interface State {
  readonly error: Error | null;
  readonly attempt: number;
}

export class ModuleErrorBoundary extends Component<ModuleErrorBoundaryProps, State> {
  public override state: State = { error: null, attempt: 0 };

  public static getDerivedStateFromError(error: Error): State {
    return { error, attempt: 0 };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Spec §15 log hygiene: codes, module id and stack only — the raw message
    // can carry user input, so it stays out of the console and the UI.
    console.error(`[module:${this.props.moduleId}] ${error.name}`, {
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  public override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className={styles.card} role="alert">
          <div className={styles.header}>
            <span className={styles.iconWrapper}>
              <IconAlertTriangle size={20} className={styles.icon} />
            </span>
            <p className={styles.title}>{this.props.title}</p>
          </div>
          <button type="button" className={styles.retry} onClick={() => this.reset()}>
            <IconRefresh size={14} className={styles.btnIcon} />
            {this.props.retryLabel}
          </button>
        </div>
      );
    }
    // Remount the subtree so the failed instance and its stale state are
    // discarded; without this a retry re-renders the same broken child.
    return <ModuleErrorBoundaryContent key={this.state.attempt}>{this.props.children}</ModuleErrorBoundaryContent>;
  }

  private reset(): void {
    this.props.onReset?.();
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }));
  }
}

function ModuleErrorBoundaryContent(props: { readonly children: ReactNode }): ReactNode {
  return props.children;
}
