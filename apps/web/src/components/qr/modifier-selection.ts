export type ModifierOptionLike = {
  id: string;
  name: string;
  price_delta: string;
  is_active?: boolean;
};

export type ModifierGroupLike = {
  id: string;
  name: string;
  is_required: boolean;
  minimum_selection: number;
  maximum_selection: number | null;
  modifiers: ModifierOptionLike[];
};

export type ModifierSelection = Record<string, string[]>;

export function toggleModifierSelection(
  current: ModifierSelection,
  group: ModifierGroupLike,
  modifierId: string,
): ModifierSelection {
  const values = current[group.id] ?? [];
  if (values.includes(modifierId)) {
    return {
      ...current,
      [group.id]: values.filter((value) => value !== modifierId),
    };
  }
  if (group.maximum_selection && values.length >= group.maximum_selection) {
    return group.maximum_selection === 1
      ? { ...current, [group.id]: [modifierId] }
      : current;
  }
  return { ...current, [group.id]: [...values, modifierId] };
}

export function invalidModifierGroup(
  groups: readonly ModifierGroupLike[],
  selected: ModifierSelection,
): ModifierGroupLike | null {
  for (const group of groups) {
    const count = (selected[group.id] ?? []).length;
    const minimum = Math.max(
      group.minimum_selection,
      group.is_required ? 1 : 0,
    );
    if (
      count < minimum ||
      (group.maximum_selection !== null && count > group.maximum_selection)
    ) {
      return group;
    }
  }
  return null;
}

export function selectedModifierOptions(
  groups: readonly ModifierGroupLike[],
  selected: ModifierSelection,
): ModifierOptionLike[] {
  return groups.flatMap((group) =>
    group.modifiers.filter(
      (modifier) =>
        modifier.is_active !== false &&
        (selected[group.id] ?? []).includes(modifier.id),
    ),
  );
}
