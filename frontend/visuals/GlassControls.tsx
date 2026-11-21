/**
 * Editorial Terminal UI Primitives:
 * - GlassSelect (aliased TerminalSelect): Accessible custom select listbox using native buttons
 * - SegmentedPills: Tactile segmented filter well
 */

import React, { useEffect, useId, useRef, useState } from "react";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface GlassSelectProps<T extends string = string> {
  id?: string;
  label?: string;
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  className?: string;
}

export function GlassSelect<T extends string = string>({
  id,
  label,
  value,
  options,
  onChange,
  className = "",
}: GlassSelectProps<T>) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const labelId = `${selectId}-label`;

  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState<number>(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value)
    )
  );

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const selectedOption = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    if (idx >= 0) setHighlightIdx(idx);

    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open, options, value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        setHighlightIdx((i) => (i + 1) % options.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        setHighlightIdx((i) => (i - 1 + options.length) % options.length);
      }
    } else if (e.key === "Home" && open) {
      e.preventDefault();
      setHighlightIdx(0);
    } else if (e.key === "End" && open) {
      e.preventDefault();
      setHighlightIdx(Math.max(0, options.length - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      if (open) {
        e.preventDefault();
        const picked = options[highlightIdx];
        if (picked) {
          onChange(picked.value);
          setOpen(false);
        }
      }
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {label && (
        <label
          id={labelId}
          htmlFor={selectId}
          className="block text-sm font-medium text-ink-secondary mb-1.5"
        >
          {label}
        </label>
      )}

      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={label ? `${labelId} ${selectId}` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        className={`w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input flex items-center justify-between gap-2 text-[15px] text-left ${
          open ? "border-accent-solid ring-2 ring-accent-tint" : ""
        }`}
      >
        <span className="truncate font-medium text-ink">{selectedOption?.label ?? value}</span>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
          className={`w-4 h-4 text-ink-muted shrink-0 transition-transform duration-150 ${
            open ? "rotate-180 text-accent" : ""
          }`}
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-labelledby={label ? labelId : undefined}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 term-popover p-1.5 space-y-0.5 max-h-64 overflow-y-auto"
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isHighlighted = idx === highlightIdx;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlightIdx(idx)}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className={`w-full text-left min-h-[44px] lg:h-9 lg:min-h-0 px-3 rounded-md flex items-center justify-between gap-2 text-[15px] transition-colors ${
                  isSelected
                    ? "bg-accent-tint text-accent font-semibold"
                    : isHighlighted
                      ? "bg-hover-bg text-ink font-medium"
                      : "text-ink-secondary hover:text-ink"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && (
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                    className="w-4 h-4 text-accent shrink-0"
                  >
                    <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const TerminalSelect = GlassSelect;

interface SegmentedPillsProps<T extends string | number> {
  ariaLabel: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}

export function SegmentedPills<T extends string | number>({
  ariaLabel,
  value,
  options,
  onChange,
  size = "md",
}: SegmentedPillsProps<T>) {
  const heightCls =
    size === "sm"
      ? "min-h-[44px] lg:h-8 lg:min-h-0 px-3 text-sm"
      : "min-h-[44px] lg:h-9 lg:min-h-0 px-3.5 text-sm";

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap items-center term-well p-1 gap-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`${heightCls} rounded-md transition-colors ${
              active
                ? "bg-surface border border-line-strong text-ink font-semibold"
                : "border border-transparent text-ink-secondary hover:text-ink font-medium"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
