"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, InfoIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { DnsRecord, Domain } from "@/lib/api";

// The DNS records a custom domain needs, laid out the way DNS provider forms
// ask for them (Type / Name / Value), each value one click to copy. Shared by
// the Domains page and a project's settings.

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }).catch(() => {});
      }}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
    >
      {done ? <CheckIcon className="h-3.5 w-3.5 text-[var(--dz-green-strong)] dark:text-brand" /> : <CopyIcon className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Records for a domain; falls back to a single CNAME for older API responses. */
export function recordsFor(d: Pick<Domain, "domain" | "cname_target" | "records">): DnsRecord[] {
  if (d.records?.length) return d.records;
  return [{ type: "CNAME", host: d.domain, value: d.cname_target || "cname.deployzy.com", required: true, purpose: `Points ${d.domain} at Deployzy` }];
}

export function DnsRecords({ records, zone, className }: { records: DnsRecord[]; zone?: string; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="overflow-hidden rounded-[14px] border border-[var(--dz-hairline)]">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--dz-hairline)] text-[12px] text-muted-foreground">
              <th className="w-[72px] px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--dz-hairline)]">
            {records.map((r) => (
              <tr key={`${r.type}:${r.host}`} className="align-middle">
                <td className="px-3 py-2">
                  <span className="font-mono text-[12.5px] font-medium">{r.type}</span>
                  {!r.required && <span className="mt-0.5 block text-[11px] text-muted-foreground">optional</span>}
                </td>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-1">
                    <span className="min-w-0 truncate font-mono text-[12.5px]">{r.host}</span>
                    <Copy text={r.host} label="name" />
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-1">
                    <span className="min-w-0 truncate font-mono text-[12.5px]">{r.value}</span>
                    <Copy text={r.value} label="value" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
        <InfoIcon className="mt-[2px] h-3.5 w-3.5 shrink-0" />
        <span>
          {zone ? <>Create these at the DNS provider for <span className="font-medium text-foreground">{zone}</span>. </> : null}
          Using Cloudflare? Set each record to <span className="font-medium text-foreground">DNS only</span> (grey cloud), not Proxied.
          We check automatically and switch the domain on, with HTTPS, as soon as the record is visible.
        </span>
      </p>
    </div>
  );
}
