import React from 'react';

/** A light stand-in for @librechat/client: real behaviour is not under test here, the library screens are. */
export const mockClient = {
  Button: ({
    children,
    asChild,
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<'button'> & { asChild?: boolean; variant?: string; size?: string }) =>
    asChild && React.isValidElement(children) ? children : <button {...props}>{children}</button>,
  Input: React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>((props, ref) => (
    <input ref={ref} {...props} />
  )),
  Spinner: () => <span role="status" data-testid="spinner" />,
  Tabs: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <div data-testid="tabs" data-value={value}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(
              child as React.ReactElement<{ onValueChange?: (v: string) => void }>,
              {
                onValueChange,
              },
            )
          : child,
      )}
    </div>
  ),
  TabsList: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange?: (v: string) => void;
  }) => (
    <div role="tablist">
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(
              child as React.ReactElement<{ onValueChange?: (v: string) => void }>,
              {
                onValueChange,
              },
            )
          : child,
      )}
    </div>
  ),
  TabsTrigger: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange?: (v: string) => void;
  }) => (
    <button role="tab" onClick={() => onValueChange?.(value)}>
      {children}
    </button>
  ),
  OGDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  OGDialogTemplate: ({
    title,
    main,
    selection,
  }: {
    title: string;
    main: React.ReactNode;
    selection: { selectHandler: () => void; selectText: string };
  }) => (
    <div>
      <h2>{title}</h2>
      {main}
      <button onClick={selection.selectHandler}>{selection.selectText}</button>
    </div>
  ),
  TooltipAnchor: ({ render }: { render: React.ReactNode }) => render,
  useToastContext: () => ({ showToast: jest.fn() }),
};
