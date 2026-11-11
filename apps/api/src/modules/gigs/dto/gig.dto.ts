import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, Equals, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString,
  Length, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GIG_LIMITS as L, GIG_ORDER_STATUSES, PACKAGE_TIERS, SERVICE_SORTS, SERVICE_STATUSES,
  type GigOrderStatus, type PackageTier, type ServiceSort, type ServiceStatus,
} from '@asteai/types';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const list = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '')
    : value;

export class ServiceDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, L.title) title: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 60) category: string;
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(L.summary) summary: string;
  @ApiProperty() @Transform(trim) @IsString() @MaxLength(L.description) description: string;
  @ApiProperty({ type: [String] })
  @Transform(list) @IsArray() @ArrayMaxSize(L.tags) @IsString({ each: true }) @MaxLength(L.tag, { each: true })
  tags: string[];
}

export class PackageDto {
  @ApiProperty({ enum: PACKAGE_TIERS }) @IsIn(PACKAGE_TIERS as readonly string[]) tier: PackageTier;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, L.packageName) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.packageDescription) description?: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(L.maxPrice) price: number;
  @ApiProperty() @IsInt() @Min(1) @Max(180) deliveryDays: number;
  @ApiProperty() @IsInt() @Min(0) @Max(10) revisions: number;
  @ApiProperty({ type: [String] })
  @Transform(list) @IsArray() @ArrayMaxSize(L.features) @IsString({ each: true }) @MaxLength(L.feature, { each: true })
  features: string[];
}

export class PackagesDto {
  @ApiProperty({ type: [PackageDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => PackageDto)
  packages: PackageDto[];
}

export class ListServicesQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(L.maxPrice) minPrice?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(L.maxPrice) maxPrice?: number;
  @ApiPropertyOptional({ enum: SERVICE_SORTS }) @IsOptional() @IsIn(SERVICE_SORTS as readonly string[]) sort?: ServiceSort;
  @ApiPropertyOptional() @IsOptional() @IsString() page?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pageSize?: string;
}

export class AdminServicesQueryDto {
  @ApiPropertyOptional({ enum: SERVICE_STATUSES }) @IsOptional() @IsIn(SERVICE_STATUSES as readonly string[]) status?: ServiceStatus;
}

export class SetServiceStatusDto {
  @ApiProperty({ enum: ['published', 'rejected'] }) @IsIn(['published', 'rejected']) status: 'published' | 'rejected';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) note?: string;
}

export class CreateOrderDto {
  @ApiProperty() @IsString() @Length(1, 32) packageId: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(10) @MaxLength(L.requirements) requirements: string;
  @ApiProperty() @IsBoolean() @Equals(true, { message: 'You must accept the package terms to order' }) acceptTerms: true;
}

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ enum: GIG_ORDER_STATUSES }) @IsOptional() @IsIn(GIG_ORDER_STATUSES as readonly string[]) status?: GigOrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() page?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pageSize?: string;
}

export class DeliverDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, L.deliveryNote) note: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @Transform(list) @IsArray() @ArrayMaxSize(L.links) @ArrayUnique() @IsString({ each: true })
  @MaxLength(500, { each: true })
  links?: string[];
}

export class RevisionDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, L.deliveryNote) note: string;
}

export class OrderReviewDto {
  @ApiProperty() @IsInt() @Min(1) @Max(5) rating: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.review) comment?: string;
}
