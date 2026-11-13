import * as z from 'zod';
import { CATEGORY_KEYS, STORAGES } from '../common/food.js';
import { EXPIRY_SOURCES, ITEM_SOURCES, ITEM_STATUSES } from './item.entity.js';

const name = z.string().trim().min(1).max(50);
const productName = z
  .string()
  .trim()
  .max(100)
  .nullish()
  .transform((value) => value || null);
const emoji = z.string().trim().min(1).max(16);
const quantity = z.int().min(1).max(999);
const unit = z.string().trim().min(1).max(10);

/** 등록할 재료 하나. 사진 결과 확인 화면과 직접 입력 둘 다 이 형태로 보낸다. */
export const NewItemSchema = z.object({
  name,
  productName,
  category: z.enum(CATEGORY_KEYS),
  /** 없으면 카테고리 기본 이모지 */
  emoji: emoji.optional(),
  quantity,
  unit: unit.default('개'),
  storage: z.enum(STORAGES),
  expiresOn: z.iso.date(),
  expirySource: z.enum(EXPIRY_SOURCES),
  source: z.enum(ITEM_SOURCES),
});

export const CreateItemsSchema = z.object({
  items: z.array(NewItemSchema).min(1).max(50),
});

export const UpdateItemSchema = z
  .object({
    name: name.optional(),
    productName: productName.optional(),
    category: z.enum(CATEGORY_KEYS).optional(),
    emoji: emoji.optional(),
    quantity: quantity.optional(),
    unit: unit.optional(),
    storage: z.enum(STORAGES).optional(),
    expiresOn: z.iso.date().optional(),
    /** 없이 expiresOn만 바꾸면 'user'가 된다 */
    expirySource: z.enum(EXPIRY_SOURCES).optional(),
  })
  .refine((patch) => Object.values(patch).some((v) => v !== undefined), {
    message: '바꿀 값이 없습니다',
  });

/** 본문이 없으면 전부 먹은 것 */
export const ConsumeSchema = z
  .object({ amount: quantity.optional() })
  .optional()
  .transform((body) => body ?? {});

export const ListItemsQuerySchema = z.object({
  status: z.enum(ITEM_STATUSES).default('active'),
  category: z.enum(CATEGORY_KEYS).optional(),
  /** 이름·상품명에서 찾는다 */
  q: z.string().trim().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const ItemIdSchema = z.uuid();

export type NewItem = z.infer<typeof NewItemSchema>;
export type CreateItems = z.infer<typeof CreateItemsSchema>;
export type UpdateItem = z.infer<typeof UpdateItemSchema>;
export type Consume = z.infer<typeof ConsumeSchema>;
export type ListItemsQuery = z.infer<typeof ListItemsQuerySchema>;
