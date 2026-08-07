"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Copy,
  Edit3,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  ShieldQuestion,
  UserCheck,
  UserRoundCog,
  UsersRound,
  UserX,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { adminApi, adminKeys } from "./admin-api";
import { ErrorState, FieldError, LoadingState, number } from "./admin-utils";
import type { Branch, Employee, Role, Station } from "./types";

const createSchema = z.object({
  display_name: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı.").max(160),
  username: z
    .string()
    .trim()
    .min(3, "Kullanıcı adı en az 3 karakter olmalı.")
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/, "Geçerli bir kullanıcı adı girin."),
  email: z.union([z.literal(""), z.string().trim().email("Geçerli bir e-posta girin.")]),
  phone: z.union([
    z.literal(""),
    z.string().trim().regex(/^[0-9+()\s.-]{7,32}$/, "Geçerli bir telefon girin."),
  ]),
  role_id: z.string().min(1, "Rol seçin."),
  branch_id: z.string(),
  preparation_station_id: z.string(),
  temporary_password: z.string().min(10, "Parola en az 10 karakter olmalı.").max(256),
  pin: z.union([
    z.literal(""),
    z.string().regex(/^\d{4,12}$/, "PIN 4–12 rakam olmalı."),
  ]),
  is_active: z.boolean(),
});

const editSchema = z.object({
  display_name: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı.").max(160),
  email: z.union([z.literal(""), z.string().trim().email("Geçerli bir e-posta girin.")]),
  phone: z.union([
    z.literal(""),
    z.string().trim().regex(/^[0-9+()\s.-]{7,32}$/, "Geçerli bir telefon girin."),
  ]),
  role_id: z.string().min(1, "Rol seçin."),
  branch_id: z.string(),
  preparation_station_id: z.string(),
  is_active: z.boolean(),
});

const credentialSchema = z.object({
  value: z.string().min(10, "Parola en az 10 karakter olmalı.").max(256),
});
const pinSchema = z.object({
  value: z.string().regex(/^\d{4,12}$/, "PIN 4–12 rakam olmalı."),
});

type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;
type EditorState = { mode: "create" } | { mode: "edit"; employee: Employee } | null;
type PinState = "configured" | "removed";

export function EmployeeManagement() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [editor, setEditor] = useState<EditorState>(null);
  const [passwordEmployee, setPasswordEmployee] = useState<Employee | null>(null);
  const [pinEmployee, setPinEmployee] = useState<Employee | null>(null);
  const [pinStates, setPinStates] = useState<Record<string, PinState>>({});

  const employeesQuery = useQuery({
    queryKey: adminKeys.employees(),
    queryFn: ({ signal }) => adminApi.employees(signal),
  });
  const rolesQuery = useQuery({
    queryKey: adminKeys.roles(),
    queryFn: ({ signal }) => adminApi.roles(signal),
  });
  const branchesQuery = useQuery({
    queryKey: adminKeys.branches(),
    queryFn: ({ signal }) => adminApi.branches(signal),
  });

  const invalidateEmployees = () =>
    queryClient.invalidateQueries({ queryKey: adminKeys.employees() });
  const createEmployee = useMutation({
    mutationFn: adminApi.createEmployee,
    onSuccess: async (employee, variables) => {
      if (variables.pin) {
        setPinStates((current) => ({ ...current, [employee.id]: "configured" }));
      }
      toast.success("Çalışan hesabı oluşturuldu.");
      setEditor(null);
      await invalidateEmployees();
    },
    onError: () => toast.error("Çalışan oluşturulamadı."),
  });
  const updateEmployee = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof adminApi.updateEmployee>[1];
    }) => adminApi.updateEmployee(id, input),
    onSuccess: async () => {
      toast.success("Çalışan bilgileri güncellendi.");
      setEditor(null);
      await invalidateEmployees();
    },
    onError: () => toast.error("Çalışan güncellenemedi."),
  });
  const toggleEmployee = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      adminApi.updateEmployee(id, { is_active: isActive }),
    onSuccess: async (_, variables) => {
      toast.success(variables.isActive ? "Çalışan yeniden etkinleştirildi." : "Çalışan devre dışı bırakıldı.");
      await invalidateEmployees();
    },
    onError: () => toast.error("Hesap durumu değiştirilemedi."),
  });

  const firstError = employeesQuery.error ?? rolesQuery.error ?? branchesQuery.error;
  if (employeesQuery.isLoading || rolesQuery.isLoading || branchesQuery.isLoading) {
    return <LoadingState label="Çalışanlar yükleniyor…" />;
  }
  if (firstError) {
    return (
      <ErrorState
        error={firstError}
        onRetry={() => {
          void employeesQuery.refetch();
          void rolesQuery.refetch();
          void branchesQuery.refetch();
        }}
      />
    );
  }

  const roles = rolesQuery.data ?? [];
  const assignableRoleIds = new Set(roles.map((role) => role.id));
  const employees = (employeesQuery.data ?? []).filter((employee) =>
    assignableRoleIds.has(employee.role_id),
  );
  const branches = branchesQuery.data ?? [];
  const normalized = search.trim().toLocaleLowerCase("tr-TR");
  const filteredEmployees = employees.filter((employee) => {
    if (roleFilter !== "ALL" && employee.role_id !== roleFilter) return false;
    if (!normalized) return true;
    return [employee.display_name, employee.username, employee.email ?? "", employee.role].some(
      (value) => value.toLocaleLowerCase("tr-TR").includes(normalized),
    );
  });

  return (
    <>
      <PageHeader
        eyebrow="Ekip ve erişim"
        title="Çalışanlar"
        description="Hesap oluşturun, rol ve şube atayın, geçici parola ve cihaz PIN’lerini güvenle yönetin."
        icon={UsersRound}
        actions={
          <Button onClick={() => setEditor({ mode: "create" })}>
            <Plus />
            Çalışan ekle
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Toplam çalışan"
          value={number(employees.length)}
          detail="Atanabilir ekip hesapları"
          icon={UsersRound}
          tone="info"
        />
        <StatCard
          title="Aktif hesap"
          value={number(employees.filter((employee) => employee.is_active).length)}
          detail="Oturum açabilir"
          icon={UserCheck}
          tone="success"
        />
        <StatCard
          title="Devre dışı"
          value={number(employees.filter((employee) => !employee.is_active).length)}
          detail="Oturumları kapatılmış"
          icon={UserX}
          tone="warning"
        />
        <StatCard
          title="Rol çeşidi"
          value={number(new Set(employees.map((employee) => employee.role_id)).size)}
          detail={`${roles.length} tanımlı rol`}
          icon={BadgeCheck}
          tone="brand"
        />
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border bg-card p-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Çalışan ara"
            name="employee-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ad, kullanıcı adı, e-posta veya rol ara…"
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value ?? "ALL")}>
          <SelectTrigger className="h-10 min-w-48 rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tüm roller</SelectItem>
            {roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {filteredEmployees.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Çalışan</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Şube</TableHead>
                  <TableHead>PIN durumu</TableHead>
                  <TableHead>Hesap</TableHead>
                  <TableHead className="pr-4 text-right">İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((employee) => (
                  <EmployeeRow
                    key={employee.id}
                    employee={employee}
                    role={roles.find((role) => role.id === employee.role_id)}
                    branch={branches.find((branch) => branch.id === employee.branch_id)}
                    pinState={
                      pinStates[employee.id] ??
                      (employee.has_pin ? "configured" : "removed")
                    }
                    onEdit={() => setEditor({ mode: "edit", employee })}
                    onPassword={() => setPasswordEmployee(employee)}
                    onPin={() => setPinEmployee(employee)}
                    onToggle={() =>
                      toggleEmployee.mutate({
                        id: employee.id,
                        isActive: !employee.is_active,
                      })
                    }
                    togglePending={
                      toggleEmployee.isPending && toggleEmployee.variables?.id === employee.id
                    }
                  />
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-5">
              <EmptyState
                compact
                title="Çalışan bulunamadı"
                description="Arama veya rol filtresini değiştirin."
                icon={UsersRound}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {editor ? (
        <EmployeeEditor
          key={editor.mode === "create" ? "create" : editor.employee.id}
          state={editor}
          roles={roles}
          branches={branches}
          pending={createEmployee.isPending || updateEmployee.isPending}
          onClose={() => setEditor(null)}
          onCreate={(values) =>
            createEmployee.mutate({
              username: values.username,
              email: values.email || null,
              phone: values.phone || null,
              display_name: values.display_name,
              role_id: values.role_id,
              branch_id:
                roles.find((role) => role.id === values.role_id)?.code === "BUSINESS_ADMIN"
                  ? null
                  : values.branch_id,
              preparation_station_id:
                roles.find((role) => role.id === values.role_id)?.code === "KITCHEN"
                  ? values.preparation_station_id || null
                  : null,
              temporary_password: values.temporary_password,
              pin: values.pin || null,
              is_active: values.is_active,
            })
          }
          onUpdate={(employee, values) =>
            updateEmployee.mutate({
              id: employee.id,
              input: {
                display_name: values.display_name,
                email: values.email || null,
                phone: values.phone || null,
                role_id: values.role_id,
                branch_id:
                  roles.find((role) => role.id === values.role_id)?.code === "BUSINESS_ADMIN"
                    ? null
                    : values.branch_id,
                preparation_station_id:
                  roles.find((role) => role.id === values.role_id)?.code === "KITCHEN"
                    ? values.preparation_station_id || null
                    : null,
                is_active: values.is_active,
              },
            })
          }
        />
      ) : null}

      <PasswordDialog
        key={passwordEmployee?.id ?? "closed-password"}
        employee={passwordEmployee}
        onClose={() => setPasswordEmployee(null)}
      />
      <PinDialog
        key={pinEmployee?.id ?? "closed-pin"}
        employee={pinEmployee}
        onClose={() => setPinEmployee(null)}
        onChanged={(state) => {
          if (pinEmployee) {
            setPinStates((current) => ({ ...current, [pinEmployee.id]: state }));
          }
        }}
      />
    </>
  );
}

function EmployeeRow({
  employee,
  role,
  branch,
  pinState,
  onEdit,
  onPassword,
  onPin,
  onToggle,
  togglePending,
}: {
  employee: Employee;
  role?: Role;
  branch?: Branch;
  pinState?: PinState;
  onEdit: () => void;
  onPassword: () => void;
  onPin: () => void;
  onToggle: () => void;
  togglePending: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="pl-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-9">
            <AvatarFallback>
              {employee.display_name
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toLocaleUpperCase("tr-TR")}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold">{employee.display_name}</p>
            <p className="text-xs text-muted-foreground">
              @{employee.username} · {employee.phone || employee.email || "iletişim yok"}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <p className="font-medium">{role?.name ?? employee.role}</p>
        <p className="text-xs text-muted-foreground">{employee.permissions.length} yetki</p>
      </TableCell>
      <TableCell>
        <p>{branch?.name ?? "Tüm şubeler"}</p>
        {employee.preparation_station_id ? (
          <p className="text-xs text-muted-foreground">Hazırlık istasyonu atanmış</p>
        ) : null}
      </TableCell>
      <TableCell>
        {pinState === "configured" ? (
          <StatusBadge tone="success">Ayarlı</StatusBadge>
        ) : pinState === "removed" ? (
          <StatusBadge tone="neutral">Kaldırıldı</StatusBadge>
        ) : (
          <StatusBadge tone="warning">
            <ShieldQuestion className="size-3" />
            API’de bilinmiyor
          </StatusBadge>
        )}
      </TableCell>
      <TableCell>
        <StatusBadge tone={employee.is_active ? "success" : "neutral"}>
          {employee.is_active ? "Aktif" : "Devre dışı"}
        </StatusBadge>
      </TableCell>
      <TableCell className="pr-4">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Çalışanı düzenle" onClick={onEdit}>
            <Edit3 />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Geçici parola ayarla" onClick={onPassword}>
            <KeyRound />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="PIN yönet" onClick={onPin}>
            <LockKeyhole />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={togglePending}
                  aria-label={employee.is_active ? "Çalışanı devre dışı bırak" : "Çalışanı etkinleştir"}
                />
              }
            >
              {employee.is_active ? <UserX /> : <UserCheck />}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {employee.is_active ? "Hesabı devre dışı bırak?" : "Hesabı yeniden etkinleştir?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {employee.is_active
                    ? `${employee.display_name} için açık oturumlar kapatılacak ve yeni giriş engellenecek.`
                    : `${employee.display_name} yeniden oturum açabilecek.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Vazgeç</AlertDialogCancel>
                <AlertDialogAction
                  variant={employee.is_active ? "destructive" : "default"}
                  onClick={onToggle}
                >
                  {employee.is_active ? "Devre dışı bırak" : "Etkinleştir"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
}

function EmployeeEditor({
  state,
  roles,
  branches,
  pending,
  onClose,
  onCreate,
  onUpdate,
}: {
  state: Exclude<EditorState, null>;
  roles: Role[];
  branches: Branch[];
  pending: boolean;
  onClose: () => void;
  onCreate: (values: CreateValues) => void;
  onUpdate: (employee: Employee, values: EditValues) => void;
}) {
  const isCreate = state.mode === "create";
  const employee = state.mode === "edit" ? state.employee : null;
  const defaultRole =
    roles.find((role) => role.code === "BUSINESS_MANAGER" && role.is_active) ??
    roles.find((role) => role.is_active);
  const defaultBranchId = branches.find((branch) => branch.is_active)?.id ?? "";
  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      display_name: "",
      username: "",
      email: "",
      phone: "",
      role_id: defaultRole?.id ?? "",
      branch_id: defaultRole?.code === "BUSINESS_ADMIN" ? "ALL" : defaultBranchId,
      preparation_station_id: "",
      temporary_password: generatePassword(),
      pin: "",
      is_active: true,
    },
  });
  const editForm = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      display_name: employee?.display_name ?? "",
      email: employee?.email ?? "",
      phone: employee?.phone ?? "",
      role_id: employee?.role_id ?? "",
      branch_id: employee?.branch_id ?? "ALL",
      preparation_station_id: employee?.preparation_station_id ?? "",
      is_active: employee?.is_active ?? true,
    },
  });
  const createRoleId = useWatch({ control: createForm.control, name: "role_id" });
  const editRoleId = useWatch({ control: editForm.control, name: "role_id" });
  const createBranchId = useWatch({ control: createForm.control, name: "branch_id" });
  const editBranchId = useWatch({ control: editForm.control, name: "branch_id" });
  const selectedRoleId = isCreate ? createRoleId : editRoleId;
  const selectedBranchId = isCreate ? createBranchId : editBranchId;
  const selectedRoleCode = roles.find((role) => role.id === selectedRoleId)?.code;
  const stationsQuery = useQuery({
    queryKey: adminKeys.stations(selectedBranchId || "none"),
    queryFn: ({ signal }) => adminApi.stations(signal, selectedBranchId),
    enabled: selectedRoleCode === "KITCHEN" && Boolean(selectedBranchId && selectedBranchId !== "ALL"),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isCreate ? "Yeni çalışan" : "Çalışanı düzenle"}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? "Rol, şube ve ilk giriş kimlik bilgilerini belirleyin."
              : "Ad, iletişim, rol ve şube atamasını güncelleyin."}
          </DialogDescription>
        </DialogHeader>

        {isCreate ? (
          <form
            id="employee-editor"
            className="space-y-4"
            onSubmit={createForm.handleSubmit(onCreate)}
          >
            <EmployeeCommonFields
              nameRegistration={createForm.register("display_name")}
              emailRegistration={createForm.register("email")}
              phoneRegistration={createForm.register("phone")}
              roleRegistration={createForm.register("role_id")}
              branchRegistration={createForm.register("branch_id")}
              stationRegistration={createForm.register("preparation_station_id")}
              nameError={createForm.formState.errors.display_name?.message}
              emailError={createForm.formState.errors.email?.message}
              phoneError={createForm.formState.errors.phone?.message}
              roleError={createForm.formState.errors.role_id?.message}
              selectedRoleCode={selectedRoleCode}
              roles={roles}
              branches={branches}
              stations={stationsQuery.data ?? []}
              stationsLoading={stationsQuery.isLoading}
            />
            <div>
              <Label htmlFor="employee-username">Kullanıcı adı</Label>
              <Input
                id="employee-username"
                autoComplete="off"
                className="mt-1.5"
                {...createForm.register("username")}
              />
              <FieldError>{createForm.formState.errors.username?.message}</FieldError>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="employee-password">Geçici parola</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void copyText(createForm.getValues("temporary_password"), "Parola kopyalandı.")
                  }
                >
                  <Copy />
                  Kopyala
                </Button>
              </div>
              <Input
                id="employee-password"
                autoComplete="new-password"
                className="mt-1.5 font-mono"
                {...createForm.register("temporary_password")}
              />
              <FieldError>{createForm.formState.errors.temporary_password?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="employee-pin">İlk PIN (isteğe bağlı)</Label>
              <Input
                id="employee-pin"
                inputMode="numeric"
                autoComplete="off"
                className="mt-1.5"
                placeholder="4–12 rakam"
                {...createForm.register("pin")}
              />
              <FieldError>{createForm.formState.errors.pin?.message}</FieldError>
            </div>
            <EmployeeActiveField control={createForm.control} id="employee-create-active" />
          </form>
        ) : (
          <form
            id="employee-editor"
            className="space-y-4"
            onSubmit={editForm.handleSubmit((values) => employee && onUpdate(employee, values))}
          >
            <EmployeeCommonFields
              nameRegistration={editForm.register("display_name")}
              emailRegistration={editForm.register("email")}
              phoneRegistration={editForm.register("phone")}
              roleRegistration={editForm.register("role_id")}
              branchRegistration={editForm.register("branch_id")}
              stationRegistration={editForm.register("preparation_station_id")}
              nameError={editForm.formState.errors.display_name?.message}
              emailError={editForm.formState.errors.email?.message}
              phoneError={editForm.formState.errors.phone?.message}
              roleError={editForm.formState.errors.role_id?.message}
              selectedRoleCode={selectedRoleCode}
              roles={roles}
              branches={branches}
              stations={stationsQuery.data ?? []}
              stationsLoading={stationsQuery.isLoading}
            />
            <EmployeeActiveField control={editForm.control} id="employee-edit-active" />
          </form>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="employee-editor" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : <UserRoundCog />}
            {isCreate ? "Hesabı oluştur" : "Değişiklikleri kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeActiveField<TValues extends FieldValues & { is_active: boolean }>({
  control,
  id,
}: {
  control: Control<TValues>;
  id: string;
}) {
  return (
    <Controller
      control={control}
      name={"is_active" as Path<TValues>}
      render={({ field }) => (
        <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/20 px-3 py-3">
          <div>
            <Label htmlFor={id}>Hesap durumu</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pasif hesap giriş yapamaz; mevcut oturumları kapatılır.
            </p>
          </div>
          <Switch id={id} checked={Boolean(field.value)} onCheckedChange={field.onChange} />
        </div>
      )}
    />
  );
}

function EmployeeCommonFields({
  nameRegistration,
  emailRegistration,
  phoneRegistration,
  roleRegistration,
  branchRegistration,
  stationRegistration,
  nameError,
  emailError,
  phoneError,
  roleError,
  selectedRoleCode,
  roles,
  branches,
  stations,
  stationsLoading,
}: {
  nameRegistration: UseFormRegisterReturn;
  emailRegistration: UseFormRegisterReturn;
  phoneRegistration: UseFormRegisterReturn;
  roleRegistration: UseFormRegisterReturn;
  branchRegistration: UseFormRegisterReturn;
  stationRegistration: UseFormRegisterReturn;
  nameError?: ReactNode;
  emailError?: ReactNode;
  phoneError?: ReactNode;
  roleError?: ReactNode;
  selectedRoleCode?: string;
  roles: Role[];
  branches: Branch[];
  stations: Station[];
  stationsLoading: boolean;
}) {
  return (
    <>
      <div>
        <Label htmlFor="employee-name">Ad soyad</Label>
        <Input id="employee-name" className="mt-1.5" {...nameRegistration} />
        <FieldError>{nameError}</FieldError>
      </div>
      <div>
        <Label htmlFor="employee-email">E-posta</Label>
        <Input
          id="employee-email"
          type="email"
          autoComplete="off"
          className="mt-1.5"
          {...emailRegistration}
        />
        <FieldError>{emailError}</FieldError>
      </div>
      <div>
        <Label htmlFor="employee-phone">Telefon</Label>
        <Input
          id="employee-phone"
          type="tel"
          autoComplete="tel"
          className="mt-1.5"
          placeholder="+90 5xx xxx xx xx"
          {...phoneRegistration}
        />
        <FieldError>{phoneError}</FieldError>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="employee-role">Rol</Label>
          <select
            id="employee-role"
            className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            {...roleRegistration}
          >
            {roles
              .filter((role) => role.is_active)
              .map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
          </select>
          <FieldError>{roleError}</FieldError>
        </div>
        {selectedRoleCode === "BUSINESS_ADMIN" ? (
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">Çalışma kapsamı</p>
            <p className="mt-0.5 text-sm font-medium">Tüm şubeler</p>
          </div>
        ) : (
          <div>
            <Label htmlFor="employee-branch">Şube</Label>
            <select
              id="employee-branch"
              required
              className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              {...branchRegistration}
            >
              <option value="">Şube seçin</option>
              {branches
                .filter((branch) => branch.is_active)
                .map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>
      {selectedRoleCode === "KITCHEN" ? (
        <div>
          <Label htmlFor="employee-station">Hazırlık istasyonu</Label>
          <select
            key={selectedRoleCode === "KITCHEN" ? stations[0]?.branch_id ?? "no-branch" : "none"}
            id="employee-station"
            required
            disabled={stationsLoading || stations.length === 0}
            className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
            {...stationRegistration}
          >
            <option value="">
              {stationsLoading
                ? "İstasyonlar yükleniyor…"
                : stations.length
                  ? "İstasyon seçin"
                  : "Bu şubede aktif istasyon yok"}
            </option>
            {stations
              .filter((station) => station.is_active)
              .map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Aşçı yalnızca seçilen istasyonun mutfak akışında çalışır.
          </p>
        </div>
      ) : null}
    </>
  );
}

function PasswordDialog({
  employee,
  onClose,
}: {
  employee: Employee | null;
  onClose: () => void;
}) {
  const form = useForm<{ value: string }>({
    resolver: zodResolver(credentialSchema),
    defaultValues: { value: generatePassword() },
  });
  const mutation = useMutation({
    mutationFn: (password: string) => adminApi.resetEmployeePassword(employee?.id ?? "", password),
    onSuccess: () => {
      toast.success("Geçici parola kaydedildi; açık oturumlar kapatıldı.");
      onClose();
      form.reset({ value: generatePassword() });
    },
    onError: () => toast.error("Parola güncellenemedi."),
  });

  return (
    <Dialog open={Boolean(employee)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Geçici parola oluştur</DialogTitle>
          <DialogDescription>
            {employee?.display_name} için parola değişecek ve mevcut oturumlar kapatılacak.
          </DialogDescription>
        </DialogHeader>
        <form
          id="password-form"
          onSubmit={form.handleSubmit(({ value }) => mutation.mutate(value))}
        >
          <Label htmlFor="temporary-password">Yeni geçici parola</Label>
          <div className="mt-1.5 flex gap-2">
            <Input
              id="temporary-password"
              className="font-mono"
              autoComplete="new-password"
              {...form.register("value")}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void copyText(form.getValues("value"), "Parola kopyalandı.")}
            >
              <Copy />
              <span className="sr-only">Parolayı kopyala</span>
            </Button>
          </div>
          <FieldError>{form.formState.errors.value?.message}</FieldError>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="password-form" disabled={mutation.isPending}>
            {mutation.isPending ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
            Parolayı kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PinDialog({
  employee,
  onClose,
  onChanged,
}: {
  employee: Employee | null;
  onClose: () => void;
  onChanged: (state: PinState) => void;
}) {
  const form = useForm<{ value: string }>({
    resolver: zodResolver(pinSchema),
    defaultValues: { value: "" },
  });
  const mutation = useMutation({
    mutationFn: (pin: string | null) => adminApi.setEmployeePin(employee?.id ?? "", pin),
    onSuccess: (_, pin) => {
      onChanged(pin ? "configured" : "removed");
      toast.success(pin ? "PIN kaydedildi." : "PIN kaldırıldı.");
      onClose();
      form.reset();
    },
    onError: () => toast.error("PIN güncellenemedi."),
  });

  return (
    <Dialog open={Boolean(employee)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cihaz PIN’ini yönet</DialogTitle>
          <DialogDescription>
            {employee?.display_name} için 4–12 rakamlı yeni PIN belirleyin veya mevcut PIN’i kaldırın.
          </DialogDescription>
        </DialogHeader>
        <form
          id="pin-form"
          onSubmit={form.handleSubmit(({ value }) => mutation.mutate(value))}
        >
          <Label htmlFor="employee-new-pin">Yeni PIN</Label>
          <Input
            id="employee-new-pin"
            className="mt-1.5"
            inputMode="numeric"
            autoComplete="off"
            placeholder="••••"
            {...form.register("value")}
          />
          <FieldError>{form.formState.errors.value?.message}</FieldError>
        </form>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate(null)}
            disabled={mutation.isPending}
          >
            PIN’i kaldır
          </Button>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="pin-form" disabled={mutation.isPending}>
            {mutation.isPending ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}
            PIN’i kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function generatePassword() {
  const bytes = new Uint32Array(3);
  if (typeof globalThis.crypto !== "undefined") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    bytes.set([Date.now(), Date.now() * 17, Date.now() * 31]);
  }
  return `Dx!${Array.from(bytes, (value) => value.toString(36)).join("-")}9a`;
}

async function copyText(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("Panoya kopyalanamadı. Metni elle seçebilirsiniz.");
  }
}
