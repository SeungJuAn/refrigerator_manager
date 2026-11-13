import {
  Controller,
  HttpCode,
  HttpStatus,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RecognitionService } from './recognition.service.js';
import type { RecognitionResult } from './recognition.schema.js';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
// 아이폰 기본 형식(HEIC)까지. Gemini가 받는 이미지 형식과 같다.
const PHOTO_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/;

@Controller('recognition')
export class RecognitionController {
  constructor(private readonly recognition: RecognitionService) {}

  /** 사진 한 장(multipart 필드 이름 `photo`)에서 식품 목록을 뽑는다. 저장은 하지 않는다. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
    }),
  )
  recognize(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: PHOTO_TYPES })
        .build(),
    )
    photo: Express.Multer.File,
  ): Promise<RecognitionResult> {
    const mediaType = PHOTO_TYPES.test(photo.mimetype)
      ? photo.mimetype
      : undefined;
    return this.recognition.recognize({ data: photo.buffer, mediaType });
  }
}
