"use client";


import { QueryClientProvider } from "@/components/providers/QueryProvider";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { PWAInstallProvider } from "@/contexts/PWAInstallContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

type ProvidersProps = {
  children: React.ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <PWAInstallProvider>
        <ToastProvider>
          <QueryClientProvider>
            <SessionProvider>{children}</SessionProvider>
          </QueryClientProvider>
        </ToastProvider>
      </PWAInstallProvider>
    </ThemeProvider>
  );
}
