import { Global, Module } from '@nestjs/common';
import { FieldEncryptionService } from './field-encryption.service';
import { ObjectStorageSseService } from './object-storage-sse.service';

@Global()
@Module({
  providers: [FieldEncryptionService, ObjectStorageSseService],
  exports: [FieldEncryptionService, ObjectStorageSseService],
})
export class CryptoModule {}
