"use client";

import { COUNTRIES, type Country } from "@/lib/country-codes";
import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

interface Props {
  value: Country;
  onChange: (next: Country) => void;
  disabled?: boolean;
}

export function CountryDialPicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listboxId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    const digits = q.replace(/[^\d]/g, "");
    return COUNTRIES.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.iso.toLowerCase().includes(q)) return true;
      if (digits && c.dial.startsWith(digits)) return true;
      return false;
    });
  }, [query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(
      `[data-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const select = useCallback(
    (c: Country) => {
      onChange(c);
      setOpen(false);
      setQuery("");
      triggerRef.current?.focus();
    },
    [onChange],
  );

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[activeIdx];
      if (pick) select(pick);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(filtered.length - 1);
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className="dial-trigger inline-flex h-full items-center gap-1.5 rounded-l-[10px] border-r border-[var(--color-border)] bg-transparent pl-3 pr-2 text-[14px] font-mono tabular-nums text-[var(--color-text)] outline-none transition-colors hover:bg-black/[0.04] focus-visible:bg-black/[0.04] disabled:opacity-50"
      >
        <span className="text-[15px] leading-none" aria-hidden>
          {value.flag}
        </span>
        <span>+{value.dial}</span>
        <ChevronDown size={12} className="text-[var(--color-text-muted)]" aria-hidden />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-[calc(100%+6px)] z-30 w-[min(20rem,90vw)] overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface,white)] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.25)]"
          role="dialog"
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <Search size={13} className="text-[var(--color-text-muted)]" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Search country or +code"
              spellCheck={false}
              aria-label="Search country or dial code"
              aria-controls={listboxId}
              aria-activedescendant={
                filtered[activeIdx] ? `${listboxId}-${filtered[activeIdx].iso}` : undefined
              }
              className="w-full bg-transparent text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] focus:outline-none"
            />
          </div>
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            className="max-h-[280px] overflow-y-auto py-1 text-[13px]"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-[12.5px] text-[var(--color-text-muted)]">
                No match
              </li>
            ) : (
              filtered.map((c, i) => (
                <li
                  key={c.iso}
                  id={`${listboxId}-${c.iso}`}
                  role="option"
                  aria-selected={c.iso === value.iso}
                  data-idx={i}
                  className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 transition-colors ${
                    i === activeIdx
                      ? "bg-black/[0.06]"
                      : c.iso === value.iso
                        ? "bg-black/[0.03]"
                        : ""
                  }`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(c);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="text-[14px] leading-none">
                      {c.flag}
                    </span>
                    <span className="truncate text-[var(--color-text)]">{c.name}</span>
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-[var(--color-text-muted)]">
                    +{c.dial}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
