import { Module } from '@nestjs/common';
import { RecognitionController } from './recognition.controller.js';
import { RecognitionService } from './recognition.service.js';

@Module({
  controllers: [RecognitionController],
  providers: [RecognitionService],
})
export class RecognitionModule {}
