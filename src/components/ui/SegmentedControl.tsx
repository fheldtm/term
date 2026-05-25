import type { ReactNode } from "react";
import { cx } from "./classNames";

type SegmentedOption<TValue extends string> = {
  value: TValue;
  label: ReactNode;
};

type SegmentedControlProps<TValue extends string> = {
  value: TValue;
  options: Array<SegmentedOption<TValue>>;
  onChange: (value: TValue) => void;
  ariaLabel: string;
  className?: string;
};

export function SegmentedControl<TValue extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className
}: SegmentedControlProps<TValue>) {
  return (
    <div className={cx("segmented", className)} aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          type="button"
          className={option.value === value ? "is-active" : ""}
          aria-pressed={option.value === value}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
