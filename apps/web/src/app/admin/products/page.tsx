import type { Metadata } from "next";

import { ProductManagement } from "@/components/catalog/product-management";

export const metadata: Metadata = {
  title: "Ürünler",
  description: "Dixora ortak ürün kataloğu yönetimi.",
};

export default function ProductsPage() {
  return <ProductManagement />;
}
