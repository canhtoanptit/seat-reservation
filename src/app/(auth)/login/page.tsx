import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/seats");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-zinc-900">Log in</h1>
      <LoginForm />
      <p className="text-sm text-zinc-600">
        No account?{" "}
        <Link href="/signup" className="text-zinc-900 underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
