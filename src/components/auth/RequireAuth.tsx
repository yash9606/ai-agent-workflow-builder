"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AppProviders";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) {
      router.replace("/login");
    }
  }, [ready, session, router]);

  if (!ready) {
    return (
      <div className="app-loading">
        <p>Loading session…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-loading">
        <p>Redirecting to login…</p>
      </div>
    );
  }

  return <>{children}</>;
}
