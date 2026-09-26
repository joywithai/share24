// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PinInput } from '@/components/share/PinInput';

// No jest-dom in this project: assert with plain DOM APIs.
afterEach(cleanup);

/** Current characters in the four boxes. */
function pinValue() {
  return boxes()
    .map((box) => box.value)
    .join('');
}

function pinText() {
  return screen.getByTestId('value').textContent ?? '';
}

/** Controlled harness: PinInput is a controlled component, so the tests need
 * somewhere for the value to live. */
function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PinInput id="pin" value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  );
}

function boxes(): [
  HTMLInputElement,
  HTMLInputElement,
  HTMLInputElement,
  HTMLInputElement,
] {
  return [
    screen.getByLabelText<HTMLInputElement>('PIN digit 1 of 4'),
    screen.getByLabelText<HTMLInputElement>('PIN digit 2 of 4'),
    screen.getByLabelText<HTMLInputElement>('PIN digit 3 of 4'),
    screen.getByLabelText<HTMLInputElement>('PIN digit 4 of 4'),
  ];
}

describe('PinInput', () => {
  it('renders four one-character boxes and keeps the first one as #pin', () => {
    render(<Harness />);
    const [first, second, third, fourth] = boxes();

    for (const box of [first, second, third, fourth]) {
      expect(box.getAttribute('maxlength')).toBe('1');
      expect(box.getAttribute('inputmode')).toBe('numeric');
    }
    expect(first.id).toBe('pin');
    expect(document.querySelector('legend')?.textContent).toBe('4-digit PIN');
  });

  it('moves the caret to the next box as digits are typed', () => {
    render(<Harness />);
    const [first, second] = boxes();

    first.focus();
    fireEvent.change(first, { target: { value: '7' } });

    expect(pinText()).toBe('7');
    expect(document.activeElement).toBe(second);
  });

  it('accepts a whole code typed one digit at a time', () => {
    render(<Harness />);
    const [first, second, third, fourth] = boxes();

    fireEvent.change(first, { target: { value: '1' } });
    fireEvent.change(second, { target: { value: '2' } });
    fireEvent.change(third, { target: { value: '3' } });
    fireEvent.change(fourth, { target: { value: '4' } });

    expect(pinText()).toBe('1234');
  });

  it('fills the boxes from a pasted code, ignoring spaces and dashes', () => {
    render(<Harness />);
    const [first] = boxes();

    fireEvent.paste(first, {
      clipboardData: { getData: () => '12-34' },
    });

    expect(pinText()).toBe('1234');
  });

  it('ignores non-digits', () => {
    render(<Harness />);
    const [first] = boxes();

    fireEvent.change(first, { target: { value: 'a' } });

    expect(pinText()).toBe('');
    expect(pinValue()).toBe('');
  });

  it('drops the last digit on backspace, then walks back through the boxes', () => {
    render(<Harness />);
    const [first, second] = boxes();

    fireEvent.change(first, { target: { value: '9' } });
    expect(pinText()).toBe('9');

    // The focus sits on box 2 (empty) after typing: backspace removes the
    // digit behind it and returns the caret there.
    fireEvent.keyDown(second, { key: 'Backspace' });
    expect(pinText()).toBe('');
    expect(document.activeElement).toBe(first);

    // Backspace on a filled box clears exactly that box.
    fireEvent.change(first, { target: { value: '9' } });
    fireEvent.keyDown(first, { key: 'Backspace' });
    expect(pinText()).toBe('');
  });

  it('sends a click on an unreachable box to the next digit to fill', () => {
    render(<Harness />);
    const [first, second, , fourth] = boxes();

    fireEvent.change(first, { target: { value: '5' } });
    fourth.focus();

    expect(document.activeElement).toBe(second);
  });

  it('carries the value in a hidden input for plain form submissions', () => {
    const { container } = render(
      <PinInput name="pin" value="12" onChange={vi.fn()} />,
    );
    const hidden = container.querySelector('input[name="pin"]');

    expect(hidden).not.toBeNull();
    expect((hidden as HTMLInputElement).value).toBe('12');
    expect((hidden as HTMLInputElement).type).toBe('hidden');
  });

  it('reports invalid state and the described-by hint to assistive tech', () => {
    render(
      <PinInput
        id="pin"
        value="12"
        onChange={vi.fn()}
        invalid
        describedBy="pin-error"
      />,
    );
    const [first] = boxes();

    expect(first.getAttribute('aria-invalid')).toBe('true');
    expect(first.getAttribute('aria-describedby')).toBe('pin-error');
  });
});
