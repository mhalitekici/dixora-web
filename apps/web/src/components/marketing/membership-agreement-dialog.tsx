"use client";

import { FileText } from "lucide-react";

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
        Üyelik Sözleşmesi&apos;ni okuyun
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
        <div className="space-y-5 text-sm leading-6 text-muted-foreground">
          {MEMBERSHIP_AGREEMENT_SECTIONS.map((section) => (
            <section key={section.heading}>
              <h3 className="mb-1.5 font-semibold text-foreground">{section.heading}</h3>
              {section.paragraphs.map((paragraph, index) => (
                <p key={index} className="mb-2 last:mb-0">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
        <DialogClose render={<Button type="button" variant="outline" className="mt-2 w-full" />}>
          Kapat
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
