import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { AddFarmForm } from "@/components/farms/add-farm-form";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { qatarDateString } from "@/lib/data/time";
import { isDemoUser } from "@/lib/farms/scope";

export const metadata: Metadata = { title: "Add a farm" };

export default async function NewFarmPage() {
  const user = await requireUser("/dashboard/farms/new");
  const canEdit = !isDemoUser(user);
  return (
    <div className="min-h-dvh">
      <DashboardHeader className="sticky top-0" user={{ name: user.name, email: user.email }} canEdit={canEdit} title="Add a farm" />
      <div className="mx-auto max-w-[1600px] px-3 pt-3 sm:px-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link href="/dashboard">
            <ArrowLeft /> All farms
          </Link>
        </Button>
        <h1 className="mt-1 font-display text-[28px] leading-tight font-semibold tracking-tight">Add a farm</h1>
        <p className="mt-1 max-w-3xl text-[13.5px] text-muted-foreground">
          Search for your farm or click the map to drop a pin on it, then set the field size or outline its boundary. You can add sensors on the next step.
        </p>
      </div>
      {canEdit ? (
        <AddFarmForm today={qatarDateString(new Date())} />
      ) : (
        <div className="mx-auto max-w-[1600px] p-3 sm:p-4">
          <p className="rounded-2xl border border-dashed bg-card p-5 text-[14px]">
            The demo account is read-only and shows the built-in demo farms.{" "}
            <Link href="/signup" className="font-semibold text-primary hover:underline">
              Create your own free account
            </Link>{" "}
            to add your farms and sensors. (Sign out first from the account menu.)
          </p>
        </div>
      )}
    </div>
  );
}
