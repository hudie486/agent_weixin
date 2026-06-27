import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AuthMe } from "@/lib/types";

export function RequireAuth() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<AuthMe>("/auth/me"),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <div className="size-6 animate-spin rounded-full border-2 border-white/20 border-t-[var(--accent)]" />
      </div>
    );
  }
  if (isError || !data?.authenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
