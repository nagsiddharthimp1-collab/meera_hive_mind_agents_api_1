'use client';

import { QueryClient, QueryClientProvider as ReactQueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';

interface QueryProviderProps {
  children: ReactNode;
}

export function QueryClientProvider({ children }: QueryProviderProps) {
  // Create a client for each user session to prevent data leakage between users
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 60 * 1000, // 1 hour
            gcTime: 60 * 60 * 1000, // 1 hour
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <ReactQueryClientProvider client={queryClient}>{children}</ReactQueryClientProvider>;
}
