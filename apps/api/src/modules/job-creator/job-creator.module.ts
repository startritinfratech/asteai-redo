import {
  Body, Controller, HttpCode, Inject, Injectable, Logger, Module, Optional, Post, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import Anthropic from '@anthropic-ai/sdk';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { JOB_BANDS, type GeneratedJobResponse, type JobBand, type User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreditsModule } from '../credits/credits.module';
import { CreditsService } from '../credits/credits.service';
import { ClaudeJobModel, JOB_MODEL, type JobModel } from './job-model';
import { normalizeGeneratedJob } from './normalize';

/** Credit price key (credit_costs, migration 026). */
export const JOB_CREATOR_FEATURE = 'ai_job_creator';

export class GenerateJobDto {
  @ApiProperty({ example: 'Backend engineer to own our payments ledger and Razorpay integration' })
  @IsString() @MinLength(10) @MaxLength(2000) rolePrompt!: string;

  @ApiProperty({ type: [String], example: ['Node.js', 'PostgreSQL'] })
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(80, { each: true }) stack!: string[];

  @ApiProperty({ enum: JOB_BANDS }) @IsIn(JOB_BANDS as readonly string[]) band!: JobBand;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) employmentType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) industry?: string;

  @ApiPropertyOptional({ minimum: 3, maximum: 10, default: 6 })
  @IsOptional() @IsInt() @Min(3) @Max(10) screeningQuestionCount?: number;
}

/**
 * AI Job Creator. The charge is taken with consumeCredits (via runMetered) before the
 * model runs and refunded automatically if generation fails.
 */
@Injectable()
export class JobCreatorService {
  constructor(
    private readonly credits: CreditsService,
    @Optional() @Inject(JOB_MODEL) private readonly model: JobModel | null,
  ) {}

  async generate(user: Pick<User, 'id'>, dto: GenerateJobDto): Promise<GeneratedJobResponse> {
    const model = this.model;
    if (!model) throw new ServiceUnavailableException('The AI Job Creator is not configured (ANTHROPIC_API_KEY)');
    const input = {
      rolePrompt: dto.rolePrompt.trim(),
      stack: dto.stack.map((s) => s.trim()).filter(Boolean),
      band: dto.band,
      questionCount: dto.screeningQuestionCount ?? 6,
    };
    return this.credits.runMetered(user.id, JOB_CREATOR_FEATURE, async (charge) => {
      const raw = await model.generate({ ...input, location: dto.location, employmentType: dto.employmentType, industry: dto.industry });
      const job = normalizeGeneratedJob(raw, input);
      // An empty result is a failed generation: throwing refunds the charge.
      if (!job.responsibilities.length || !job.evaluationRubric.length) {
        throw new ServiceUnavailableException('The job creator returned an incomplete job; your credits were refunded');
      }
      return { job, credits: { charged: charge.cost, balance: charge.balance } };
    });
  }
}

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('ai/jobs')
export class JobCreatorController {
  constructor(private readonly svc: JobCreatorService) {}

  @Post('generate')
  @HttpCode(200)
  @Roles('Employer', 'Admin')
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Generate job requirements, screening questions and an evaluation rubric (metered)' })
  generate(@CurrentUser() user: User, @Body() dto: GenerateJobDto) {
    return this.svc.generate(user, dto);
  }
}

@Module({
  imports: [CreditsModule],
  controllers: [JobCreatorController],
  providers: [
    JobCreatorService,
    {
      provide: JOB_MODEL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const apiKey = config.get<string>('ANTHROPIC_API_KEY');
        if (!apiKey) {
          new Logger('JobCreatorModule').warn('ANTHROPIC_API_KEY not set: the AI Job Creator is disabled');
          return null;
        }
        return new ClaudeJobModel(new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 }), config.get<string>('JOB_CREATOR_MODEL') ?? 'claude-opus-5-5');
      },
    },
  ],
})
export class JobCreatorModule {}
