import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SignupForm } from "./SignupForm";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/seats");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-zinc-900">Create account</h1>
      <SignupForm />
      <p className="text-sm text-zinc-600">
        Already have an account?{" "}
        <Link href="/login" className="text-zinc-900 underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
