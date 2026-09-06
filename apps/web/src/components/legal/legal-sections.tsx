import type { LegalSection } from "@/components/legal/legal-document";

/**
 * Renders a document's sections identically wherever it appears — the quick
 * read in the registration dialog and the full published page. One renderer
 * for one data source, so the two can never drift into showing different text
 * for the same agreement.
 */
export function LegalSections({ sections }: { sections: LegalSection[] }) {
  return (
    <div className="space-y-6 text-sm leading-6 text-muted-foreground">
      {sections.map((section) => (
        <section key={section.heading}>
          <h2 className="mb-1.5 font-semibold text-foreground">
            {section.heading}
          </h2>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index} className="mb-2 last:mb-0">
              {paragraph}
            </p>
          ))}
          {section.list ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {section.list.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}
