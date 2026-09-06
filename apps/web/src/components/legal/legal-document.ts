/**
 * Shared shape for every published legal document (membership agreement, KVKK
 * notice, privacy policy, cookie policy, cancellation & refund policy).
 *
 * One type so the membership agreement's existing dialog and every new full
 * page render from the same structure with the same component, instead of
 * each document inventing its own markup.
 */
export type LegalSection = {
  heading: string;
  paragraphs: string[];
  /** Optional bullet list rendered after the paragraphs — used for things like
   * cookie categories or data-category enumerations where a flat list reads
   * better than prose. */
  list?: string[];
};

export type LegalDocument = {
  title: string;
  /** Bumped whenever the binding or informational text changes. Registration
   * consent is recorded against this version, so an older acceptance is never
   * read as agreement to newer terms. */
  version: string;
  /** Human-readable effective date shown at the top of the page, kept in sync
   * with `version` by whoever edits the document. */
  effectiveDate: string;
  sections: LegalSection[];
};
