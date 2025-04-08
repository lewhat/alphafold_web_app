export const isValidSequence = (sequence: string): boolean => {
  if (!sequence || typeof sequence !== "string") return false;

  const validAminoAcids = "ACDEFGHIKLMNPQRSTVWY";
  return sequence
    .split("")
    .every((char) => validAminoAcids.includes(char.toUpperCase()));
};
