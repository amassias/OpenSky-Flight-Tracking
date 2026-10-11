import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "./icons";

interface PanelBoundaryProps {
  /** Names the panel in the message, e.g. "flight details". */
  label: string;
  /** Changing it clears a caught error, e.g. when another flight is selected. */
  resetKey?: string | number | null;
  /** Class of a frame around the message, so it sits where the panel was. */
  frameClassName?: string;
  children: ReactNode;
}

interface PanelBoundaryState {
  error: Error | null;
  resetKey?: string | number | null;
}

/**
 * Contains a render error to one panel. Without it, one unexpected API body
 * unmounts the whole app and leaves an empty screen.
 */
export class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  state: PanelBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<PanelBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: PanelBoundaryProps, state: PanelBoundaryState): Partial<PanelBoundaryState> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`SkyTrace ${this.props.label} failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = (
      <div className="panel-error" role="alert">
        <TriangleAlert size={16} aria-hidden="true" />
        <p>The {this.props.label} could not be shown. The map keeps working.</p>
        <button type="button" className="secondary-button" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
    return this.props.frameClassName ? <div className={this.props.frameClassName}>{message}</div> : message;
  }
}
