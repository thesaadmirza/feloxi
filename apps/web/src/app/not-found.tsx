import Link from "next/link";
import { FeloxiLogo } from "@/components/icons/feloxi-logo";
import { FlatPulse } from "@/components/ui/pulse";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-6 text-center">
      <FeloxiLogo size={32} />
      <FlatPulse />
      <div>
        <h1 className="text-lg font-semibold tracking-[-0.01em]">Nothing at this address</h1>
        <p className="mt-1 text-[13.5px] text-t2">
          The page may have moved, or the link is incomplete.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-card px-3 text-[13px] font-[550] transition-colors hover:bg-raised"
      >
        Back to overview
      </Link>
    </main>
  );
}
