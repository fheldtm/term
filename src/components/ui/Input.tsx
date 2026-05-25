import { forwardRef } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes
} from "react";
import { cx } from "./classNames";

type FieldProps = {
  label: ReactNode;
  htmlFor: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
  short?: boolean;
};

export function Field({
  label,
  htmlFor,
  children,
  className,
  wide = false,
  short = false
}: FieldProps) {
  return (
    <div className={cx("field", wide && "field--wide", short && "field--short", className)}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input ref={ref} {...props} />;
  }
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea(props, ref) {
    return <textarea ref={ref} {...props} />;
  }
);
