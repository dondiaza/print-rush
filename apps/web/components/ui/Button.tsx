"use client";

import type { ButtonHTMLAttributes, Ref, ReactNode } from "react";

/**
 * THE BUTTON.
 *
 * There was no shared button before this. Every screen wrote its own — `.cta-primary`, `.cta-ghost`,
 * `.icon-button`, `.touch-button`, `.back-button`, plus a dozen bare `<button>` elements inside the
 * studio panels — and the result is what a screenshot of the app looked like: a set of controls that
 * plainly came from different places. A game's controls have to feel like one object, and that is not
 * something a stylesheet can retrofit onto seven unrelated class names.
 *
 * The variants are the four the interface actually needs, not a component-library sweep:
 *
 *  - `primary` — the one thing the screen wants you to do. There is at most one per screen.
 *  - `secondary` — a real choice, weighted below the primary but still solid.
 *  - `ghost` — navigation and dismissal. Legible, not shouting.
 *  - `icon` — square, for a single glyph where a label would not fit.
 *
 * `loading` is a state rather than a caller's problem: an async action that leaves its own button
 * looking idle is how a player ends up pressing it three times. Setting it disables the button and
 * swaps in a spinner while keeping the label's width, so the layout does not jump.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "icon";
export type ButtonSize = "sm" | "md" | "lg" | "hero";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks input. The label stays, so the button keeps its width. */
  loading?: boolean;
  /** Trailing glyph — an arrow on a primary, a chevron on a back link. Purely decorative. */
  trailing?: ReactNode;
  /** Leading glyph, usually an icon. */
  leading?: ReactNode;
  /** Stretches to the container's width. For stacked menus, where ragged edges read as sloppy. */
  block?: boolean;
  /**
   * Passed straight through. React 19 accepts `ref` as an ordinary prop on a function component, so
   * there is no `forwardRef` wrapper — but it still has to be declared, because the props type here
   * is an `Omit` of the DOM attributes and `ref` is not one of those.
   */
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  trailing,
  leading,
  block = false,
  disabled,
  children,
  ...rest
}: Props) {
  const classes = ["pr-button", `pr-button--${variant}`, `pr-button--${size}`];
  if (block) classes.push("pr-button--block");
  if (loading) classes.push("is-loading");

  return (
    <button
      {...rest}
      className={classes.join(" ")}
      // Disabled *and* aria-busy while loading: the first stops the double press, the second is what
      // tells a screen reader that the button is working rather than broken.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {leading && <span className="pr-button__leading">{leading}</span>}
      <span className="pr-button__label">{children}</span>
      {loading ? <span className="pr-button__spinner" aria-hidden="true" /> : trailing && <span className="pr-button__trailing">{trailing}</span>}
    </button>
  );
}

/**
 * A link wearing the button's clothes.
 *
 * Needed wherever the action is a real navigation rather than a state change: the garage, the studio,
 * and the "back to home" escape from a crashed screen. An `<a>` rather than a `<button>` with a
 * handler because it *is* a navigation — middle-click, open in a new tab and the browser's own
 * "where does this go" all keep working, and after a render crash a full page load is what actually
 * clears the broken tree.
 */
export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  trailing,
  block = false,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  trailing?: ReactNode;
  block?: boolean;
  children?: ReactNode;
}) {
  const classes = ["pr-button", `pr-button--${variant}`, `pr-button--${size}`];
  if (block) classes.push("pr-button--block");
  return (
    <a className={classes.join(" ")} href={href}>
      <span className="pr-button__label">{children}</span>
      {trailing && <span className="pr-button__trailing">{trailing}</span>}
    </a>
  );
}

/**
 * A menu tile: a big square-ish target with a glyph, a label and an optional value.
 *
 * The home's secondary actions are these rather than buttons in a row. A row of five equal-weight
 * text buttons is what made the old home read as a website's navigation; a grid of tiles that each
 * show *what is currently selected* reads as a game menu, and it also answers the question the player
 * actually has — which character am I using — without a second screen.
 */
export function MenuTile({
  label,
  value,
  glyph,
  onClick,
  href,
}: {
  label: string;
  value?: string | null;
  glyph: ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <span className="pr-tile__glyph" aria-hidden="true">{glyph}</span>
      <span className="pr-tile__label">{label}</span>
      {value !== undefined && <span className="pr-tile__value">{value ?? "—"}</span>}
    </>
  );
  if (href) {
    return <a className="pr-tile" href={href}>{inner}</a>;
  }
  return <button type="button" className="pr-tile" onClick={onClick}>{inner}</button>;
}
