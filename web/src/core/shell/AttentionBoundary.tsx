import { Component, type ReactNode } from "react";

/** Optional attention chunks must never take the working page or its unsaved input down with them. */
export class AttentionBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback ?? null : this.props.children; }
}
