"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AppProviders";

export default function HomePage() {
  const { session, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(session ? "/dashboard" : "/login");
  }, [ready, session, router]);

  return (
    <div className="app-loading">
      <p>Loading…</p>
    </div>
  );
}
