"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, ButtonLink } from "./Button";

/**
 * THE ERROR BOUNDARY.
 *
 * There was none, and in a WebGL app that is a worse gap than it sounds. A thrown error inside a
 * render loop, a mesh builder, or a `useEffect` that touches a disposed scene unmounts the whole tree
 * and leaves the player looking at a blank black page with no way back — no message, no reload, no
 * indication that anything happened at all. That is the single worst failure mode this app has, and
 * it costs one component to remove.
 *
 * The scope is deliberately narrow: this catches *render and lifecycle* errors, which is all React
 * error boundaries can catch. It does not catch a throw inside `engine.runRenderLoop`, because that
 * runs outside React's call stack — those are handled where the loop is, by guarding the frame. And it
 * does not catch a rejected promise, which is why the fetch paths have their own fallbacks.
 *
 * What it must never do is swallow the error. `onError` receives it so the caller can log it, and it
 * always reaches the console: a boundary that quietly shows a friendly message is how a bug survives
 * to production unnoticed.
 */

type Props = {
  children: ReactNode;
  /** What to show instead. Defaults to the card below. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Where this boundary sits, for the log line. "race", "home", "character studio". */
  scope: string;
  onError?: (error: Error, info: ErrorInfo) => void;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Always logged, boundary or not. See the note above: a silent boundary hides bugs.
    console.error(`[${this.props.scope}] render failed`, error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="pr-error" role="alert">
        <div className="pr-error__inner">
          <span className="pr-error__eyebrow">ALGO SE HA ROTO</span>
          <h2>NO HEMOS PODIDO<br />DIBUJAR ESTA PANTALLA</h2>
          {/* The message, not a stack trace. A player cannot act on a stack trace, and the trace is
              already in the console for whoever can. */}
          <p>{error.message || "Error desconocido en el renderizado."}</p>
          <div className="pr-error__actions">
            <Button variant="primary" size="lg" onClick={this.reset} trailing="↻">REINTENTAR</Button>
            <ButtonLink variant="ghost" href="/">VOLVER AL INICIO</ButtonLink>
          </div>
        </div>
      </div>
    );
  }
}
