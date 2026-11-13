import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AiModelError,
  AiOutputError,
  AiService,
  describeModel,
} from '@nestjs/ai';
import {
  RECOGNITION_INSTRUCTIONS,
  RECOGNITION_REQUEST,
} from './recognition.prompt.js';
import {
  RecognitionResultSchema,
  type RecognitionResult,
  type RecognizedItem,
} from './recognition.schema.js';

export interface Photo {
  data: Buffer;
  /** 예: image/jpeg. 모르면 비워 둔다. */
  mediaType?: string;
}

@Injectable()
export class RecognitionService {
  private readonly logger = new Logger(RecognitionService.name);

  constructor(private readonly ai: AiService) {}

  async recognize(photo: Photo): Promise<RecognitionResult> {
    try {
      const { object } = await this.ai.generateObject({
        label: 'recognize-groceries',
        schema: RecognitionResultSchema,
        instructions: RECOGNITION_INSTRUCTIONS,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: RECOGNITION_REQUEST },
              // 'image'만 주면 AI SDK가 파일 내용으로 세부 형식(image/jpeg 등)을 알아낸다
              {
                type: 'file',
                data: photo.data,
                mediaType: photo.mediaType ?? 'image',
              },
            ],
          },
        ],
      });
      return { items: object.items.map(normalizeItem).filter(hasName) };
    } catch (error) {
      if (error instanceof AiOutputError) {
        this.logger.warn(
          `인식 결과가 스키마와 맞지 않음: ${error.text.slice(0, 300)}`,
        );
        throw new BadGatewayException(
          '사진 인식 결과를 해석하지 못했습니다. 다시 시도해 주세요.',
        );
      }
      if (error instanceof AiModelError) {
        // 원래 에러를 통째로 남기면 요청 본문(사진 base64)까지 찍힐 수 있어서 메시지만 남긴다.
        const attempts = error.attempts
          .map(
            (a) =>
              `${describeModel(a.model)} #${a.attempt}: ${errorMessage(a.error)}`,
          )
          .join(' | ');
        this.logger.error(`Gemini 호출 실패: ${attempts}`);
        throw new ServiceUnavailableException(
          '사진 인식을 지금 쓸 수 없습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
      throw error;
    }
  }
}

function normalizeItem(item: RecognizedItem): RecognizedItem {
  return {
    ...item,
    name: item.name.trim(),
    productName: item.productName?.trim() || null,
    quantity: item.quantity > 0 ? item.quantity : 1,
    unit: item.unit.trim() || '개',
    expiryDate: normalizeDate(item.expiryDate),
    shelfLifeDays: Math.max(1, Math.round(item.shelfLifeDays)),
  };
}

function hasName(item: RecognizedItem): boolean {
  return item.name.length > 0;
}

/** "2026-11-20", "2026.11.20", "2026/11/20", "20261120" → "2026-11-20". 실제 없는 날짜나 다른 형식이면 null. */
export function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
