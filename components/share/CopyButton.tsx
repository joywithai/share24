'use client';

import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

interface CopyButtonProps {
  /** Text to copy. Defaults to the current page URL when omitted. */
  value?: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}

export function CopyButton({
  value,
  label = 'Copy link',
  copiedLabel = 'Copied!',
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy() {
    const text =
      value ?? (typeof window !== 'undefined' ? window.location.href : '');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context) — fallback.
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={copy}
      className={className}
      aria-live="polite"
    >
      {copied ? copiedLabel : label}
    </Button>
  );
}
