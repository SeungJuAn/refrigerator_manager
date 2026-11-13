/** 카테고리 키 → 화면에 보일 이름. 순서가 앱 필터 칩 순서다. (docs/features.md 결정 4) */
export const CATEGORY_LABELS = {
  vegetable: '채소',
  fruit: '과일',
  meat_egg: '육류·계란',
  seafood: '수산',
  dairy: '유제품',
  tofu_processed: '두부·가공',
  side_dish: '반찬·김치',
  sauce: '소스·양념',
  beverage: '음료',
  ready_meal: '간편식',
  other: '기타',
} as const;

export type Category = keyof typeof CATEGORY_LABELS;

export const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS) as [
  Category,
  ...Category[],
];

/** 이모지가 없을 때 쓰는 기본값 (결정 5) */
export const CATEGORY_EMOJI: Record<Category, string> = {
  vegetable: '🥬',
  fruit: '🍎',
  meat_egg: '🥩',
  seafood: '🐟',
  dairy: '🥛',
  tofu_processed: '🫘',
  side_dish: '🥢',
  sauce: '🧂',
  beverage: '🧃',
  ready_meal: '🍱',
  other: '📦',
};

/** 보관 위치: 냉장, 냉동, 실온 */
export const STORAGES = ['fridge', 'freezer', 'pantry'] as const;
export type Storage = (typeof STORAGES)[number];
