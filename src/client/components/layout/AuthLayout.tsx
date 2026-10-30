// Sign-in, invite and password screens: brand panel on the left (desktop), form on the right
import type { ReactNode } from "react";
import { History, Mail, ShieldCheck, type LucideIcon } from "lucide-react";
import { FocusRealmLogo } from "../brand/FocusRealmLogo";
import { BrandLockup } from "./Brand";

const POINTS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: ShieldCheck, title: "Approved before it sends", text: "A person reviews every campaign. Test sends and limits come first." },
  { icon: Mail, title: "From your own mailbox", text: "Messages go out through the FocusRealm address, so replies come home." },
  { icon: History, title: "Every result on record", text: "Delivered, bounced, replied or unsubscribed, recipient by recipient." },
];

function BrandPanel() {
  return (
    <aside className="relative hidden w-[44%] max-w-[620px] flex-col justify-between overflow-hidden bg-navy px-12 py-10 text-white lg:flex xl:px-16">
      {/* Quiet grid texture and a soft light, kept subtle */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "44px 44px" }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full bg-brand opacity-25 blur-3xl" aria-hidden="true" />

      <div className="relative flex items-center gap-3">
        <FocusRealmLogo size={40} />
        <div className="leading-tight">
          <p className="text-[17px] font-semibold tracking-tight">FocusRealm</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Mail Merge</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <h2 className="text-[32px] font-semibold leading-[1.15] tracking-tight text-white">Personal outreach, sent with care.</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-white/65">One template, a personal email for every contact, and a clear record of what happened next.</p>
        <ul className="mt-10 space-y-6">
          {POINTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] ring-1 ring-white/10">
                <Icon className="h-[18px] w-[18px] text-[#8DB8FF]" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-white">{title}</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-white/60">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-white/40">© {new Date().getFullYear()} FocusRealm · Internal workspace</p>
    </aside>
  );
}

export function AuthLayout({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface">
      <BrandPanel />
      <main className="flex flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full max-w-[380px] animate-fade-in">
            <BrandLockup size="lg" className="mb-10 lg:hidden" />
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-2 text-sm leading-6 text-ink-subtle">{description}</p>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 border-t border-line pt-6 text-[13px] leading-5 text-ink-subtle">{footer}</div>}
          </div>
        </div>
        <p className="pb-6 text-center text-xs text-ink-faint lg:hidden">FocusRealm Mail Merge · Internal workspace</p>
      </main>
    </div>
  );
}
