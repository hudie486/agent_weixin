import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { Toaster } from "sonner";

const queryClient = new QueryClient({
  // 任何查询失败都弹一次 toast（按错误信息去重），让 404/500/断连等不再"静默卡骨架屏"
  queryCache: new QueryCache({
    onError: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(msg, { id: `q:${msg}` });
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 3000,
    },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="top-center"
        theme="system"
        toastOptions={{
          style: {
            background: "var(--glass-bg-strong)",
            border: "1px solid var(--glass-border)",
            color: "var(--fg)",
            backdropFilter: "blur(18px)",
          },
        }}
      />
    </QueryClientProvider>
  );
}
