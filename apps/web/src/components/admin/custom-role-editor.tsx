"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/use-auth";
import { hasPermission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { adminApi, adminKeys } from "./admin-api";
import { permissionLabels, permissionCategory } from "./permission-labels";
import type { Role, RoleCreateInput } from "./types";

type Draft = RoleCreateInput & { id?: string };
export function CustomRoleEditor({ roles }: { roles: Role[] }) {
  const current = useCurrentUser();
  const allowed = hasPermission(current.data, "roles.manage");
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const permissions = useQuery({
    queryKey: adminKeys.permissions(),
    queryFn: () => adminApi.permissions(),
    enabled: allowed,
  });
  const save = useMutation({
    mutationFn: (value: Draft) =>
      value.id
        ? adminApi.updateRole(value.id, {
            name: value.name,
            permission_codes: value.permission_codes,
          })
        : adminApi.createRole(value),
    onSuccess: async () => {
      setDraft(null);
      toast.success("Rol kaydedildi.");
      await cache.invalidateQueries();
    },
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => adminApi.updateRole(id, { is_active: false }),
    onSuccess: async () => {
      toast.success("Rol devre dışı bırakıldı.");
      await cache.invalidateQueries();
    },
  });
  function fromTemplate(role?: Role, edit = false) {
    save.reset();
    const sourceProfile = role?.operational_profile ?? role?.code ?? "WAITER";
    const profile = [
      "BUSINESS_OWNER",
      "BUSINESS_ADMIN",
      "BUSINESS_MANAGER",
    ].includes(sourceProfile)
      ? "MANAGEMENT"
      : ["WAITER", "CASHIER", "MANAGEMENT", "BACKOFFICE"].includes(
            sourceProfile,
          )
        ? sourceProfile
        : "BACKOFFICE";
    setDraft({
      id: edit ? role?.id : undefined,
      code:
        edit && role
          ? role.code
          : `CUSTOM_${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
      name: role ? role.name + (edit ? "" : " — Özel") : "",
      operational_profile: profile as Draft["operational_profile"],
      permission_codes: (role?.permissions ?? []).filter((code) =>
        permissions.data?.includes(code),
      ),
    });
  }
  return (
    <section className="mb-5 space-y-3" aria-label="Özel roller">
      {allowed ? (
        <Button disabled={!permissions.data} onClick={() => fromTemplate()}>
          Yeni rol oluştur
        </Button>
      ) : null}
      {permissions.error || deactivate.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(permissions.error ?? deactivate.error)?.message}
        </p>
      ) : null}
      <div className="divide-y rounded-xl border bg-card">
        {roles.map((role) => (
          <article key={role.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">
                {role.name}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  · {role.is_system ? "Sistem şablonu" : "Özel rol"} ·{" "}
                  {role.is_active ? "Aktif" : "Devre dışı"}
                </span>
              </h2>
              {allowed ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!permissions.data}
                    onClick={() => fromTemplate(role)}
                  >
                    Şablondan kopyala
                  </Button>
                  {!role.is_system ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => fromTemplate(role, true)}
                      >
                        Düzenle
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={!role.is_active || deactivate.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `“${role.name}” rolü devre dışı bırakılsın mı?`,
                            )
                          )
                            deactivate.mutate(role.id);
                        }}
                      >
                        Devre dışı bırak
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer py-2">
                Yapabildiği işlemler ({role.permissions.length})
              </summary>
              <ul className="grid gap-2 sm:grid-cols-2">
                {role.permissions.map((code) => (
                  <li key={code}>{permissionLabels[code] ?? code}</li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </div>
      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setDraft(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Özel rol</DialogTitle>
            <DialogDescription>
              Çalışma profili iş kurallarını belirler. Yetkiler mevcut
              oturumlara da uygulanır.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!save.isPending) save.mutate(draft);
              }}
            >
              <div>
                <Label htmlFor="role-name">Rol adı</Label>
                <Input
                  id="role-name"
                  required
                  minLength={2}
                  maxLength={100}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="role-profile">Çalışma profili</Label>
                <select
                  id="role-profile"
                  className="min-h-11 w-full rounded-md border bg-background px-3"
                  disabled={Boolean(draft.id)}
                  value={draft.operational_profile}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      operational_profile: e.target
                        .value as Draft["operational_profile"],
                    })
                  }
                >
                  <option value="WAITER">Garson</option>
                  <option value="CASHIER">Kasiyer</option>
                  <option value="MANAGEMENT">Yönetim</option>
                  <option value="BACKOFFICE">Ofis / rapor</option>
                </select>
              </div>
              {[
                ...new Set((permissions.data ?? []).map(permissionCategory)),
              ].map((category) => (
                <fieldset key={category} className="rounded-lg border p-3">
                  <legend className="text-sm font-semibold">{category}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {permissions.data
                      ?.filter((code) => permissionCategory(code) === category)
                      .map((code) => (
                        <label
                          key={code}
                          className="flex min-h-11 items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={draft.permission_codes.includes(code)}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                permission_codes: e.target.checked
                                  ? [...draft.permission_codes, code]
                                  : draft.permission_codes.filter(
                                      (item) => item !== code,
                                    ),
                              })
                            }
                          />
                          {permissionLabels[code] ?? code}
                        </label>
                      ))}
                  </div>
                </fieldset>
              ))}
              {save.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {save.error.message}
                </p>
              ) : null}
              <Button
                type="submit"
                disabled={save.isPending || !draft.name.trim()}
              >
                {save.isPending ? "Kaydediliyor…" : "Rolü kaydet"}
              </Button>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
