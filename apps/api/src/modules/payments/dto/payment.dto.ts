import { IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** What Razorpay Checkout passes to its `handler` (razorpay_order_id / _payment_id / _signature). */
export class VerifyCheckoutDto {
  @ApiProperty({ example: 'order_OZ6ItPFFCFlq1R' })
  @IsString() @MaxLength(64) @Matches(/^order_[A-Za-z0-9]+$/, { message: 'orderId must be a Razorpay order id' })
  orderId: string;

  @ApiProperty({ example: 'pay_OZ6J0hxGkVJ1ZH' })
  @IsString() @MaxLength(64) @Matches(/^pay_[A-Za-z0-9]+$/, { message: 'paymentId must be a Razorpay payment id' })
  paymentId: string;

  /** Hex HMAC; its length and content are checked (timing-safe) by the service. */
  @ApiProperty() @IsString() @MaxLength(256) signature: string;
}
