"use client";

import { COUNTRIES, type Country, findByIso } from "@/lib/country-codes";
import { useMemo, useState } from "react";
import {
  Button,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  TextField,
} from "react-aria-components";

interface Props {
  value: Country;
  onChange: (next: Country) => void;
  disabled?: boolean;
}

export function CountryDialPicker({ value, onChange, disabled }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    const digits = q.replace(/[^\d]/g, "");
    return COUNTRIES.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.iso.toLowerCase() === q) return true;
      if (digits && c.dial.startsWith(digits)) return true;
      return false;
    });
  }, [query]);

  return (
    <Select
      aria-label="Phone number country code"
      selectedKey={value.iso}
      onSelectionChange={(key) => {
        const next = findByIso(String(key));
        if (next) onChange(next);
        setQuery("");
      }}
      isDisabled={disabled}
    >
      <Button className="country-trigger flex h-full items-center gap-1.5 rounded-l-[10px] border-r border-[var(--color-border)] bg-transparent pl-3 pr-2 text-[14px] text-[var(--color-text)] outline-none transition-colors data-[hovered]:bg-black/[0.04] data-[focused]:bg-black/[0.04] data-[disabled]:opacity-50">
        <SelectValue<Country>>
          {({ selectedItem }) => (
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="font-mono tabular-nums">
                {selectedItem ? `${selectedItem.name} (+${selectedItem.dial})` : "Select country"}
              </span>
            </span>
          )}
        </SelectValue>
        <Chevron />
      </Button>
      <Popover
        placement="bottom start"
        offset={6}
        className="z-30 w-[min(20rem,90vw)] overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface,white)] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.25)] data-[entering]:animate-in data-[entering]:fade-in data-[entering]:zoom-in-95 data-[exiting]:animate-out data-[exiting]:fade-out data-[exiting]:zoom-out-95"
      >
        <TextField aria-label="Search country or +code" value={query} onChange={setQuery} autoFocus>
          <Label className="sr-only">Search</Label>
          <Input
            placeholder="Search country or +code"
            spellCheck={false}
            className="w-full border-b border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] focus:outline-none"
          />
        </TextField>
        <ListBox
          aria-label="Countries"
          items={filtered}
          className="max-h-[280px] overflow-y-auto py-1 text-[13px]"
          renderEmptyState={() => (
            <div className="px-3 py-4 text-center text-[12.5px] text-[var(--color-text-muted)]">
              No match
            </div>
          )}
        >
          {(c) => (
            <ListBoxItem
              id={c.iso}
              textValue={`${c.name} +${c.dial}`}
              className="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left outline-none data-[focused]:bg-black/[0.06] data-[selected]:bg-black/[0.03]"
            >
              <span className="truncate text-[var(--color-text)]">{c.name}</span>
              <span className="font-mono text-[12px] tabular-nums text-[var(--color-text-muted)]">
                +{c.dial}
              </span>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}

function Chevron() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="-mr-0.5 text-[var(--color-text-muted)]"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.29289 9.29289C5.68342 8.90237 6.31658 8.90237 6.70711 9.29289L12 14.5858L17.2929 9.29289C17.6834 8.90237 18.3166 8.90237 18.7071 9.29289C19.0976 9.68342 19.0976 10.3166 18.7071 10.7071L12.7071 16.7071C12.5196 16.8946 12.2652 17 12 17C11.7348 17 11.4804 16.8946 11.2929 16.7071L5.29289 10.7071C4.90237 10.3166 4.90237 9.68342 5.29289 9.29289Z"
        fill="currentColor"
      />
    </svg>
  );
}
