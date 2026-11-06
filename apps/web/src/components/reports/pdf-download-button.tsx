"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function PdfDownloadButton({ from, to }: { from: string; to: string }) {
  const download = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/backend/reports/export.pdf?${new URLSearchParams({ date_from: from, date_to: to })}`,
        { cache: "no-store", headers: { accept: "application/pdf" } },
      );
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/pdf")
      )
        throw new Error(
          "PDF oluşturulamadı. Yetkinizi ve tarih aralığını kontrol edip yeniden deneyin.",
        );
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `dixora-rapor-${from}-${to}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (error) => toast.error(error.message),
    onSuccess: () => toast.success("PDF raporu indirildi."),
  });
  return (
    <Button disabled={download.isPending} onClick={() => download.mutate()}>
      {download.isPending ? "PDF hazırlanıyor…" : "PDF olarak indir"}
    </Button>
  );
}
