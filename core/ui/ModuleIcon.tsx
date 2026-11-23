import type { CSSProperties, ReactElement } from 'react';
import { moduleIconSvg } from '../../generated/module-manifest';

/**
 * Renders a module's declared SVG icon inside a sized box. The SVG source
 * comes from the generated icon map (build-time trusted module assets), never
 * from runtime input.
 */
export function ModuleIcon(props: { readonly svg: string | undefined; readonly size: number }): ReactElement {
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: props.size,
    height: props.size,
    flexShrink: 0,
  };
  if (!props.svg) {
    return <span style={style} aria-hidden="true" />;
  }
  const sized = props.svg.includes('<svg')
    ? props.svg.replace(/<svg\b/, `<svg width="${props.size}" height="${props.size}"`)
    : props.svg;
  return <span style={style} aria-hidden="true" dangerouslySetInnerHTML={{ __html: sized }} />;
}

/**
 * A module's declared icon resolved by id: one place for the
 * generated-registry lookup so entrypoints cannot drift on the indexing or
 * the fallback for unknown ids.
 */
export function ModuleBadge(props: { readonly id: string; readonly size: number }): ReactElement {
  return <ModuleIcon svg={moduleIconSvg[props.id as keyof typeof moduleIconSvg]} size={props.size} />;
}
