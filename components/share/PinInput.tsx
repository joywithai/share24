'use client';

import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
} from 'react';

import { cn } from '@/lib/utils';

const LENGTH = 4;

interface PinInputProps {
  /** id of the *first* box (keeps `<Label htmlFor="pin">` working). */
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  /** id of the hint / error paragraph describing this field. */
  describedBy?: string;
  /** Renders a hidden input under this name, so a plain <form> can submit the
   * PIN to a server action. */
  name?: string;
  /** Put the caret in the first box on mount. */
  autoFocus?: boolean;
  /** Bump this counter to send the caret back to the first empty box — used
   * after a refused attempt clears the boxes. */
  focusRequest?: number;
}

/**
 * The optional 4-digit PIN, as four single-character boxes instead of one wide
 * text field: it shows exactly how much is expected, and typing flows from one
 * box to the next.
 *
 * The value is kept contiguous — there are never gaps — so the boxes and the
 * submitted string can never disagree.
 */
export function PinInput({
  id = 'pin',
  value,
  onChange,
  onBlur,
  disabled = false,
  invalid = false,
  describedBy,
  name,
  autoFocus = false,
  focusRequest,
}: PinInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  // Focus can land on the next box *before* React has committed the new value
  // (state updates are async, `focus()` is not), and the onFocus guard below
  // would then read a stale value and bounce the caret back to the old box.
  // Handlers therefore update this ref eagerly and render keeps it in sync.
  const valueRef = useRef(value);
  valueRef.current = value;
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '');
  // The box the visitor is expected on: the first empty one (the last one once
  // all four digits are in).
  const cursor = Math.min(value.length, LENGTH - 1);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!focusRequest) return;
    // The first empty box is where typing continues.
    const target = refs.current[valueRef.current.length] ?? refs.current[0];
    target?.focus();
  }, [focusRequest]);

  function focusAt(index: number) {
    const target = refs.current[Math.max(0, Math.min(LENGTH - 1, index))];
    target?.focus();
    target?.select();
  }

  function commit(next: string) {
    valueRef.current = next;
    onChange(next);
  }

  function handleChange(index: number, raw: string) {
    const typed = raw.replace(/\D/g, '');
    if (!typed) {
      // Clearing a box drops it and everything after it.
      commit(valueRef.current.slice(0, index));
      return;
    }
    const next = (valueRef.current.slice(0, index) + typed).slice(0, LENGTH);
    commit(next);
    focusAt(next.length);
  }

  function handleKeyDown(
    index: number,
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) {
        commit(valueRef.current.slice(0, index));
        focusAt(index);
        return;
      }
      // Empty box → step back over the previous digit.
      commit(valueRef.current.slice(0, -1));
      focusAt(Math.max(0, valueRef.current.length - 1));
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusAt(index - 1);
      return;
    }
    if (event.key === 'ArrowRight' && index < LENGTH - 1) {
      event.preventDefault();
      focusAt(index + 1);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, LENGTH);
    if (!pasted) return;
    event.preventDefault();
    commit(pasted);
    focusAt(pasted.length);
  }

  function handleFocus(index: number) {
    // Clicking a box that is not reachable yet lands on the current one.
    if (index > valueRef.current.length) {
      focusAt(valueRef.current.length);
      return;
    }
    refs.current[index]?.select();
  }

  return (
    <fieldset className="flex min-w-0 items-center gap-1.5">
      <legend className="sr-only">{`${LENGTH}-digit PIN`}</legend>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {digits.map((digit, index) => (
        <input
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length boxes
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          id={index === 0 ? id : `${id}-${index + 1}`}
          type="text"
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          maxLength={1}
          aria-label={`PIN digit ${index + 1} of ${LENGTH}`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            handleChange(index, event.target.value)
          }
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={() => handleFocus(index)}
          onBlur={onBlur}
          className={cn(
            'h-10 w-9 rounded-lg border bg-bg text-center font-mono text-base text-fg shadow-sm outline-none transition-colors',
            'focus:border-accent focus:ring-2 focus:ring-accent/30',
            invalid ? 'border-danger' : 'border-line',
            // A gentle nudge towards the box being filled.
            index === cursor && !disabled && !digit
              ? 'border-accent/50'
              : undefined,
            disabled ? 'cursor-not-allowed opacity-50' : undefined,
          )}
        />
      ))}
    </fieldset>
  );
}
