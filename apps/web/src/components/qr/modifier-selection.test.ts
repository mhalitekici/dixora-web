import { describe, expect, it } from "vitest";

import {
  invalidModifierGroup,
  selectedModifierOptions,
  toggleModifierSelection,
  type ModifierGroupLike,
} from "./modifier-selection";

const requiredSingle: ModifierGroupLike = {
  id: "base",
  name: "Baz",
  is_required: true,
  minimum_selection: 1,
  maximum_selection: 1,
  modifiers: [
    { id: "espresso", name: "Espresso", price_delta: "50.00" },
    { id: "filter", name: "Filtre", price_delta: "40.00" },
  ],
};

describe("shared modifier selection rules", () => {
  it("enforces required/minimum selection", () => {
    expect(invalidModifierGroup([requiredSingle], {})).toBe(requiredSingle);
    expect(
      invalidModifierGroup([requiredSingle], { base: ["espresso"] }),
    ).toBeNull();
  });

  it("replaces the selected option in a single-select group", () => {
    const selected = toggleModifierSelection(
      { base: ["espresso"] },
      requiredSingle,
      "filter",
    );
    expect(selected.base).toEqual(["filter"]);
  });

  it("returns only active selected options across multiple groups", () => {
    const optional: ModifierGroupLike = {
      id: "extra",
      name: "Ekstra",
      is_required: false,
      minimum_selection: 0,
      maximum_selection: 2,
      modifiers: [
        { id: "shot", name: "Extra Shot", price_delta: "30.00" },
        {
          id: "old",
          name: "Arşivli",
          price_delta: "10.00",
          is_active: false,
        },
      ],
    };
    expect(
      selectedModifierOptions([requiredSingle, optional], {
        base: ["espresso"],
        extra: ["shot", "old"],
      }).map((option) => option.id),
    ).toEqual(["espresso", "shot"]);
  });
});
