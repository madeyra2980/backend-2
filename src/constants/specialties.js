/** Список специальностей для режима специалиста. Единый источник правды для backend. */
export const SPECIALTIES = [
  { id: 'santehnik', label: 'Сантехник' },
  { id: 'elektrik', label: 'Электрик' },
  { id: 'cleaning', label: 'Уборка / Клининг' },
  { id: 'cargo', label: 'Грузоперевозки' },
  { id: 'repair', label: 'Ремонт техники' },
  { id: 'loader', label: 'Грузчик' },
];

const ID_SET = new Set(SPECIALTIES.map((s) => s.id));

/** Проверить, что id входит в разрешённый список */
export function isAllowedSpecialtyId(id) {
  return typeof id === 'string' && ID_SET.has(id);
}

/** Отфильтровать массив id, оставив только разрешённые */
export function filterAllowedSpecialtyIds(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => isAllowedSpecialtyId(id));
}
