import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModuleErrorBoundary } from '../../../core/ui/ModuleErrorBoundary';

afterEach(() => {
  cleanup();
});

function Boom({ shouldThrow }: { shouldThrow: boolean }): ReactElement {
  if (shouldThrow) {
    throw new Error('module exploded');
  }
  return <p>module ok</p>;
}

describe('ModuleErrorBoundary', () => {
  it('isolates a throwing module from its sibling', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <ModuleErrorBoundary moduleId="bad-tool" title="Bad failed" retryLabel="Retry">
          <Boom shouldThrow />
        </ModuleErrorBoundary>
        <ModuleErrorBoundary moduleId="good-tool" title="Good failed" retryLabel="Retry">
          <p>sibling ok</p>
        </ModuleErrorBoundary>
      </div>,
    );
    expect(screen.getByText('Bad failed')).toBeInTheDocument();
    expect(screen.getByText('sibling ok')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('retries after an Error Boundary reset', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    function Harness(): ReactElement {
      const [shouldThrow, setShouldThrow] = useState(true);
      return (
        <ModuleErrorBoundary
          moduleId="retry-tool"
          title="Retry failed"
          retryLabel="Retry"
          onReset={() => {
            setShouldThrow(false);
          }}
        >
          <Boom shouldThrow={shouldThrow} />
        </ModuleErrorBoundary>
      );
    }
    render(<Harness />);
    expect(screen.getByText('Retry failed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('module ok')).toBeInTheDocument();
    spy.mockRestore();
  });
});
