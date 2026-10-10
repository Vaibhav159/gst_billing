import { Component, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/core/ui";

type Props = { children: ReactNode; onHome?: () => void };

/** A screen that fails to draw shows this instead of a blank page. */
export class ScreenBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error("Screen failed to draw:", err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="p-6 flex justify-center">
        <div role="alert" className="card max-w-[520px] w-full p-6 flex flex-col gap-3">
          <p className="text-lg font-semibold">Something went wrong on this page</p>
          <p className="text-fg2">Nothing you saved is affected. Reload the app, or go back to the home page and try again. If it happens again, tell the owner what you were doing.</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <Button variant="primary" icon={RotateCw} onClick={() => window.location.reload()}>Reload the app</Button>
            <Button onClick={() => { this.setState({ failed: false }); this.props.onHome?.(); }}>Go to the home page</Button>
          </div>
        </div>
      </div>
    );
  }
}
