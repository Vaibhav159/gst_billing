import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, type DataRouter } from "react-router";
import { queryClient } from "@/core/api/query";
import { AuthProvider } from "@/core/auth/AuthProvider";
import { ToastProvider, useToast } from "@/core/ui";
import { appRoutes } from "@/core/router/routes";

const router = createBrowserRouter(appRoutes);

/** Who is signed in. When another tab signs in as someone else, this tab follows and says who it is now (Ruling 30). */
function Auth({ children }: { children: ReactNode }) {
  const { show } = useToast();
  return (
    <AuthProvider onSwitchedUser={(me) => show({ title: `Signed in as ${me.fullName}`, body: "A sign-in on another tab changed who is signed in here.", tone: "brand" })}>
      {children}
    </AuthProvider>
  );
}

/**
 * The app's providers around a router: App gives it the browser's, tests a memory router.
 * Toasts sit above sign-in so it can raise one; the router's root layout shows them.
 */
export function AppRoutes({ router }: { router: DataRouter }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider><Auth><RouterProvider router={router} /></Auth></ToastProvider>
    </QueryClientProvider>
  );
}

export default function App() {
  return <AppRoutes router={router} />;
}
