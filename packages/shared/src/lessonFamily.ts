/**
 * Lesson-version families (browser-safe — imported by both the API and the web
 * bundle). A revision of lesson `orient-101` ships as the NEW, immutable lab
 * `orient-101-v2`; the FAMILY is the version-less base id (v1 keeps the bare
 * id). Blueprint validation reserves the `-v<N>` suffix (a newly minted lesson
 * id may not match it), so stripping is unambiguous.
 */
export const familyOf = (labId: string): string => labId.replace(/-v\d+$/, "");

/** 1 for the bare family id; N for `<family>-v<N>`. */
export const versionOf = (labId: string): number => {
  const m = labId.match(/-v(\d+)$/);
  return m ? Number(m[1]) : 1;
};

/** The labId a given version of a family ships under. */
export const versionedLabId = (family: string, version: number): string =>
  version <= 1 ? family : `${family}-v${version}`;
