"use client";
import { SignedIn, SignedOut } from "@/lib/auth";
import { Marketing } from "@/components/Marketing";
import { DispatchPanel } from "@/components/DispatchPanel";
import { ActiveCallsRail } from "@/components/ActiveCallsRail";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { useApiSWR } from "@/lib/api";
import type { Worker } from "@/lib/types";

export default function Home() {
  return (
    <>
      <SignedOut><Marketing /></SignedOut>
      <SignedIn><Dashboard /></SignedIn>
    </>
  );
}

function Dashboard() {
  const { data: workersResp, mutate } = useApiSWR<{ workers: Worker[] }>("/api/workers");
  const workers = workersResp?.workers ?? [];
  const noWorker = workers.length === 0;

  return (
    <div className="flex">
      <div className="flex-1 min-w-0 px-8 py-8 max-w-5xl">
        {noWorker && <div className="mb-8"><OnboardingFlow onMinted={() => mutate()} /></div>}
        <DispatchPanel />
      </div>
      <ActiveCallsRail />
    </div>
  );
}
