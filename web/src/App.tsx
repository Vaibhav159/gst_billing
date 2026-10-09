import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, type DataRouter } from "react-router";
import { queryClient } from "@/core/api/query";
import { AuthProvider } from "@/core/auth/AuthProvider";
import { ToastProvider } from "@/core/ui";
import { appRoutes } from "@/core/router/routes";

const router = createBrowserRouter(appRoutes);

/** The app's providers around a router: App gives it the browser's, tests a memory router. */
export function AppRoutes({ router }: { router: DataRouter }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthProvider>
    </QueryClientProvider>
  );
}

export default function App() {
  return <AppRoutes router={router} />;
}
