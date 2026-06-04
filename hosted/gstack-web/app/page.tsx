"use client";
import { SignedIn, SignedOut } from "@/lib/auth";
import { Marketing } from "@/components/Marketing";
import { DispatchPanel } from "@/components/DispatchPanel";
import { ActiveCallsRail } from "@/components/ActiveCallsRail";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { useApiSWR } from "@/lib/api";
import type { User, Worker } from "@/lib/types";

export default function Home() {
  return (
    <>
      <SignedOut><Marketing /></SignedOut>
      <SignedIn><Dashboard /></SignedIn>
    </>
  );
}

function Dashboard() {
  const { data: meResp } = useApiSWR<{ user: User }>("/api/me");
  const isAdmin = meResp?.user?.role === "admin";

  return isAdmin ? <AdminDashboard /> : <MemberDashboard />;
}

/* Admin sees the full ops view — brain pool, live calls, onboarding for
 * their own brains. */
function AdminDashboard() {
  const { data: workersResp, mutate } = useApiSWR<{ workers: Worker[] }>("/api/workers");
  const noBrain = (workersResp?.workers ?? []).length === 0;
  return (
    <div className="flex flex-col xl:flex-row">
      <div className="flex-1 min-w-0 px-6 lg:px-8 py-6 xl:py-8 xl:max-w-3xl 2xl:max-w-5xl">
        {noBrain && <div className="mb-8"><OnboardingFlow onMinted={() => mutate()} /></div>}
        <DispatchPanel />
      </div>
      <div className="xl:order-last px-6 lg:px-8 xl:px-0 pb-6 xl:pb-0">
        <ActiveCallsRail />
      </div>
    </div>
  );
}

/* Member sees just the dispatch action. Workers / brains / call audit
 * are invisible — bots are powered by the admin pool. The empty-state
 * "demo busy" modal (Phase B) handles the "no brain available" case. */
function MemberDashboard() {
  return (
    <div className="flex-1 min-w-0 px-6 lg:px-8 py-6 xl:py-8 max-w-4xl mx-auto">
      <DispatchPanel />
    </div>
  );
}
