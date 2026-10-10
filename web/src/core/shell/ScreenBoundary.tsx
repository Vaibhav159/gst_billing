import { Component, useContext, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { RotateCw } from "lucide-react";
import { RoleContext } from "@/core/auth/role";
import { Button } from "@/core/ui";

type Props = { children: ReactNode; onHome?: () => void };

/** What a screen that failed to draw shows instead of a blank page: what happened, and Reload or the home page. */
function ScreenFailed({ onHome }: { onHome: () => void }) {
  // who to turn to depends on who's asking, as in LoadError: the owner has no owner to tell
  const again = useContext(RoleContext) === "owner" ? "call the person who looks after the app and tell them what you were doing" : "tell the owner what you were doing";
  return (
    <div className="p-6 flex justify-center">
      <div role="alert" className="card max-w-[520px] w-full p-6 flex flex-col gap-3">
        <p className="text-lg font-semibold">Something went wrong on this page</p>
        <p className="text-fg2">Nothing you saved is affected. Reload the app, or go back to the home page and try again. If it happens again, {again}.</p>
        <div className="flex flex-wrap gap-2 mt-1">
          <Button variant="primary" icon={RotateCw} onClick={() => window.location.reload()}>Reload the app</Button>
          <Button onClick={onHome}>Go to the home page</Button>
        </div>
      </div>
    </div>
  );
}

/** A screen that fails to draw shows ScreenFailed instead of a blank page. */
export class ScreenBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error("Screen failed to draw:", err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <ScreenFailed onHome={() => { this.setState({ failed: false }); this.props.onHome?.(); }} />;
  }
}

/**
 * The root route's errorElement: anything outside a page's own ScreenBoundary that fails to draw (the shell, sign-in,
 * the sign-in check, search) says the same, never React Router's own error page with its stack trace. React Router
 * reports the error, and clears it when the home page opens.
 */
export function AppFailed() {
  const navigate = useNavigate();
  return <ScreenFailed onHome={() => navigate("/")} />;
}
