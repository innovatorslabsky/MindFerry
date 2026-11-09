import React from 'react';
import { mockClient } from './libraryMocks';

/** The shared stand-in for @librechat/client, plus the few parts the Agents page also draws. */
export const mockBridgeClient = {
  ...mockClient,
  OGDialogTemplate: ({ title, main }: { title?: string; main?: React.ReactNode }) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {main}
    </div>
  ),
  Label: ({ htmlFor, children, ...props }: React.ComponentProps<'label'>) => (
    <label htmlFor={htmlFor} {...props}>
      {children}
    </label>
  ),
  Textarea: React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
    (props, ref) => <textarea ref={ref} {...props} />,
  ),
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <p>{title}</p>
      <p>{description}</p>
    </div>
  ),
};

/** Renders a key with its values, so a test can see which string and which numbers were asked for. */
export const mockLocalize = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${Object.values(options).join(',')}` : key;
