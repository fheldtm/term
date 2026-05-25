import type { ButtonHTMLAttributes } from "react";
import { cx } from "./classNames";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "menuItem";
type IconButtonVariant =
  | "toolbar"
  | "round"
  | "submit"
  | "modal"
  | "context"
  | "explorerToggle"
  | "attachmentRemove";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: IconButtonVariant;
};

const buttonClassByVariant: Record<ButtonVariant, string> = {
  primary: "primary-button",
  secondary: "secondary-button",
  ghost: "ghost-button",
  danger: "danger-button",
  menuItem: "menu-item-button"
};

const iconClassByVariant: Record<IconButtonVariant, string> = {
  toolbar: "icon-action",
  round: "round-icon-button",
  submit: "submit-button",
  modal: "modal-close-button",
  context: "context-icon-button",
  explorerToggle: "explorer-toggle",
  attachmentRemove: "attachment-tile__remove"
};

export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(buttonClassByVariant[variant], className)}
      type={type}
      {...props}
    />
  );
}

export function IconButton({
  variant,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      className={cx(iconClassByVariant[variant], className)}
      type={type}
      {...props}
    />
  );
}
