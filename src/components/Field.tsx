import { createContext, useContext, useId, type ComponentPropsWithRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cx } from './lib/cx';
import { Icon } from './icons/Icon';
import { DangerMark } from './icons/glyphs';

export interface FieldContextValue {
  /** id for the control element (input / select button). */
  id: string;
  labelId: string;
  /** Space-separated ids for aria-describedby (help + error). */
  describedBy: string | undefined;
  invalid: boolean;
  disabled: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Inside a <Field>, controls read their id, label and description wiring from here. */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  /** Engraved caption above the control ("age", "weight"). Lowercase. */
  label: ReactNode;
  /** Help text under the control (12 px, ink-2). */
  help?: ReactNode;
  /** Error message; marks the control invalid and is announced. */
  error?: ReactNode;
  /** Visually hide the label (keeps it for assistive tech). */
  hideLabel?: boolean;
  disabled?: boolean;
  required?: boolean;
  /** Override the generated control id. */
  id?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Label + control + help + error, wired for assistive tech. Controls from this
 * library (TextInput, NumberField, Stepper, Select, KeyBank…) pick the wiring
 * up automatically via `useField()`.
 */
export function Field({ label, help, error, hideLabel, disabled = false, required = false, id, className, children }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `f${auto}`;
  const labelId = `${controlId}-label`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;
  const value: FieldContextValue = { id: controlId, labelId, describedBy, invalid: Boolean(error), disabled, required };
  return (
    <FieldContext.Provider value={value}>
      <div className={cx('lm-field', className)}>
        <Label id={labelId} htmlFor={controlId} className={hideLabel ? 'lm-sr' : undefined} data-disabled={disabled || undefined}>
          {label}
          {required ? <span className="lm-sr"> (required)</span> : null}
        </Label>
        {children}
        {error ? <ErrorText id={errorId}>{error}</ErrorText> : null}
        {help ? <HelpText id={helpId}>{help}</HelpText> : null}
      </div>
    </FieldContext.Provider>
  );
}

/** Engraved control label. */
export function Label({ className, ...rest }: ComponentPropsWithoutRef<'label'> & { 'data-disabled'?: boolean }) {
  return <label className={cx('lm-field__label', className)} {...rest} />;
}

/** Help text under a control. */
export function HelpText({ className, ...rest }: ComponentPropsWithoutRef<'p'>) {
  return <p className={cx('lm-help', className)} {...rest} />;
}

/** Validation message: danger mark + text, announced politely. */
export function ErrorText({ className, children, ...rest }: ComponentPropsWithoutRef<'p'>) {
  return (
    <p className={cx('lm-error', className)} role="alert" {...rest}>
      <Icon icon={DangerMark} size={16} />
      <span>{children}</span>
    </p>
  );
}

export interface TextInputProps extends ComponentPropsWithRef<'input'> {
  invalid?: boolean;
}

/** Single-line text in a recessed well. 16 px on mobile (no iOS zoom). */
export function TextInput({ className, invalid, id, disabled, required, 'aria-describedby': describedBy, ...rest }: TextInputProps) {
  const field = useField();
  return (
    <input
      id={id ?? field?.id}
      className={cx('lm-input', className)}
      aria-invalid={invalid || field?.invalid || undefined}
      aria-describedby={[describedBy, field?.describedBy].filter(Boolean).join(' ') || undefined}
      disabled={disabled ?? field?.disabled}
      required={required ?? field?.required}
      {...rest}
    />
  );
}
