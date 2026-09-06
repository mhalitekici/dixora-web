"use client";

import { FileText } from "lucide-react";

import { LegalSections } from "@/components/legal/legal-sections";
import {
  MEMBERSHIP_AGREEMENT_SECTIONS,
  MEMBERSHIP_AGREEMENT_TITLE,
} from "@/components/marketing/membership-agreement";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function MembershipAgreementDialog({
  triggerClassName,
}: {
  triggerClassName?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className={
              triggerClassName ??
              "font-semibold text-foreground underline underline-offset-2 hover:text-brand"
            }
          />
        }
      >
        Üyelik ve SaaS Hizmet Sözleşmesi
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-brand" aria-hidden="true" />
            {MEMBERSHIP_AGREEMENT_TITLE}
          </DialogTitle>
          <DialogDescription>
            Kayıt olmadan önce lütfen aşağıdaki sözleşmeyi okuyun. Kayıt formunu
            onaylamanız, bu sözleşmeyi kabul ettiğiniz anlamına gelir.
          </DialogDescription>
        </DialogHeader>
        <LegalSections sections={MEMBERSHIP_AGREEMENT_SECTIONS} />
        <p className="text-xs text-muted-foreground">
          Sözleşmenin tam metnini ayrı bir sayfada okumak isterseniz{" "}
          <a
            href="/uyelik-sozlesmesi"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline underline-offset-2 hover:text-brand"
          >
            buraya
          </a>{" "}
          bakabilirsiniz.
        </p>
        <DialogClose render={<Button type="button" variant="outline" className="mt-2 w-full" />}>
          Kapat
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
