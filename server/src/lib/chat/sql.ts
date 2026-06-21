/**
 * SQL-выражения нормализации, согласованные с TS-функцией `norm`
 * (lower + ё→е + схлопывание пробелов + trim). Для равенства имён.
 */
export const nrmExpr = (col: string): string =>
  `btrim(regexp_replace(translate(lower(${col}), 'ё', 'е'), '\\s+', ' ', 'g'))`;

/** Лёгкая нормализация для триграммной similarity (регистр + ё→е). */
export const simExpr = (col: string): string => `translate(lower(${col}), 'ё', 'е')`;
