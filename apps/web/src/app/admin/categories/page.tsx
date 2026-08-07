import type { Metadata } from "next";

import { CategoryManagement } from "@/components/catalog/category-management";

export const metadata: Metadata = {
  title: "Kategoriler",
};

export default function CategoriesPage() {
  return <CategoryManagement />;
}
