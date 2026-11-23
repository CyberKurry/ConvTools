import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  icon?: ReactNode | undefined;
  iconPosition?: 'left' | 'right' | undefined;
}

export function Button(props: ButtonProps): ReactElement {
  const {
    className,
    type = 'button',
    variant = 'secondary',
    size = 'md',
    icon,
    iconPosition = 'left',
    children,
    ...rest
  } = props;

  const variantClass = styles[variant] ?? styles.secondary;
  const sizeClass = size === 'icon' ? styles.iconSize : (styles[size] ?? styles.md);

  return (
    <button
      type={type}
      className={[styles.button, variantClass, sizeClass, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {icon && iconPosition === 'left' ? <span className={styles.icon}>{icon}</span> : null}
      {children !== undefined && children !== null ? <span className={styles.label}>{children}</span> : null}
      {icon && iconPosition === 'right' ? <span className={styles.icon}>{icon}</span> : null}
    </button>
  );
}
