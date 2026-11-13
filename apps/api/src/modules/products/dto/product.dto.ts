import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PRODUCT_LICENSES, PRODUCT_LIMITS as L, PRODUCT_STATUSES, type ProductLicense, type ProductStatus } from '@asteai/types';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const list = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '') : value;

export class ProductDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, L.title) title: string;
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(L.summary) summary: string;
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(L.description) description: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 60) category: string;
  @ApiProperty({ type: [String] })
  @Transform(list) @IsArray() @ArrayMaxSize(L.tags) @IsString({ each: true }) @MaxLength(L.tag, { each: true })
  tags: string[];
  @ApiProperty({ description: 'Price in paise (minor units).' }) @IsInt() @Min(100) @Max(L.maxPriceMinor) priceMinor: number;
  @ApiProperty({ enum: PRODUCT_LICENSES }) @IsIn(PRODUCT_LICENSES as readonly string[]) license: ProductLicense;
}

export class ListProductsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() page?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pageSize?: string;
}

export class AdminProductsQueryDto {
  @ApiPropertyOptional({ enum: PRODUCT_STATUSES }) @IsOptional() @IsIn(PRODUCT_STATUSES as readonly string[]) status?: ProductStatus;
}

export class ReviewProductDto {
  @ApiProperty({ enum: ['active', 'rejected'] }) @IsIn(['active', 'rejected']) status: 'active' | 'rejected';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
}
