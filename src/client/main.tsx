// FocusRealm Mail Merge — client entry
import React from "react";
import ReactDOM from "react-dom/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./lib/api";
import { AuthProvider, meQueryKey } from "./lib/auth";
import { ToastProvider } from "./components/ui/Toast";
import App from "./App";
import "./styles/globals.css";

// A 401 from any call means the session ended: re-check it so the route guard shows sign-in
function onApiError(err: unknown) {
  if (err instanceof ApiError && err.status === 401 && err.code === "NOT_AUTHENTICATED") {
    void queryClient.invalidateQueries({ queryKey: meQueryKey });
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
