/**
 * Global providers for every story.
 *
 * Mirrors main.tsx: a primitive that needs the toast bus, a tooltip provider or
 * the query cache must get them here, or its story diverges from how it renders
 * in the app — which is the specific failure mode a workbench is supposed to
 * prevent.
 *
 * Ladle's theme addon toggles `.dark` on <html>; the tokens do the rest.
 */
import * as React from "react";
import type { GlobalProvider } from "@ladle/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeQueryClient } from "../src/lib/query-client";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { ToastProvider } from "../src/components/ui/toast";
import "../src/index.css";

const queryClient = makeQueryClient();

export const Provider: GlobalProvider = ({ children }) => (
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <TooltipProvider>
        <MemoryRouter>
          <div className="bg-background p-8 text-foreground">{children}</div>
        </MemoryRouter>
      </TooltipProvider>
    </ToastProvider>
  </QueryClientProvider>
);
