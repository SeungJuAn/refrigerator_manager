import * as z from 'zod';

// Gemini에 이 스키마의 JSON Schema가 그대로 전달된다.
// 숫자 범위·날짜 형식 같은 제약은 일부러 넣지 않았다: 모델이 조금만 어긋나도 답 전체가 거부되기 때문에,
// 느슨하게 받고 recognition.service.ts에서 정리한다.
export const RecognizedItemSchema = z.object({
  name: z
    .string()
    .describe(
      '요리에 쓰는 재료 이름. 짧게. 예: "서울우유 1L" → "우유", "해찬들 태양초 고추장" → "고추장"',
    ),
  productName: z
    .string()
    .nullable()
    .describe(
      '포장지에 보이는 상품명 그대로. 포장이 없거나 글자가 안 보이면 null',
    ),
  quantity: z.number().describe('개수. 같은 물건이 여러 개면 합친 개수'),
  unit: z.string().describe('개수 단위. 예: 개, 팩, 병, 봉, 캔, 단, 모'),
  storage: z
    .enum(['fridge', 'freezer', 'pantry'])
    .describe('권장 보관 위치. fridge=냉장, freezer=냉동, pantry=실온'),
  expiryDate: z
    .string()
    .nullable()
    .describe(
      '포장지에 찍힌 유통기한·소비기한을 읽었을 때만 YYYY-MM-DD. 안 보이면 null. 추측하지 않는다',
    ),
  shelfLifeDays: z
    .number()
    .describe('storage에 보관했을 때 개봉 전 기준으로 보통 먹을 수 있는 일수'),
  confidence: z
    .enum(['high', 'low'])
    .describe(
      '이 항목을 확신하면 high. 가려졌거나 흐리거나 종류가 애매하면 low',
    ),
});

export const RecognitionResultSchema = z.object({
  items: z
    .array(RecognizedItemSchema)
    .describe('사진 속 식품 목록. 식품이 없으면 빈 배열'),
});

export type RecognizedItem = z.infer<typeof RecognizedItemSchema>;
export type RecognitionResult = z.infer<typeof RecognitionResultSchema>;
