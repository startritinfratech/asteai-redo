import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { validateEnv } from './config/env.validation';

import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { RequisitionsModule } from './modules/requisitions/requisitions.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { PassportsModule } from './modules/passports/passports.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ProposalsModule } from './modules/proposals/proposals.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AdminModule } from './modules/admin/admin.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { VoiceModule } from './modules/voice/voice.module';
import { AiModule } from './modules/ai/ai.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { InterviewsModule } from './modules/interviews/interviews.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { HealthModule } from './modules/health/health.module';
import { EmailModule } from './modules/email/email.module';
import { ChatsModule } from './modules/chats/chats.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { GigsModule } from './modules/gigs/gigs.module';
import { SecurityModule } from './common/security/security.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { PublicModule } from './modules/public/public.module';
import { ProductsModule } from './modules/products/products.module';
import { SupportModule } from './modules/support/support.module';
import { CreditsModule } from './modules/credits/credits.module';
import { CredentialsModule } from './modules/credentials/credentials.module';
import { ChallengesModule } from './modules/challenges/challenges.module';
import { ResumesModule } from './modules/resumes/resumes.module';
import { JobCreatorModule } from './modules/job-creator/job-creator.module';
import { TalentPoolsModule } from './modules/talent-pools/talent-pools.module';
import { OutreachModule } from './modules/outreach/outreach.module';
import { ExpertSearchModule } from './modules/expert-search/expert-search.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'], validate: validateEnv }),

    ThrottlerModule.forRoot([
      { name: 'short',  ttl: 1000,  limit: 10 },
      { name: 'medium', ttl: 10000, limit: 50 },
      { name: 'long',   ttl: 60000, limit: 200 },
    ]),

    DatabaseModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    RequisitionsModule,
    ApplicationsModule,
    AssessmentsModule,
    PassportsModule,
    ProjectsModule,
    ProposalsModule,
    AnalyticsModule,
    AdminModule,
    NotificationsModule,
    LedgerModule,
    VoiceModule,
    AiModule,
    CertificatesModule,
    InterviewsModule,
    AssistantModule,
    HealthModule,
    EmailModule,
    ChatsModule,
    ContractsModule,
    ProfilesModule,
    PaymentsModule,
    InvoicesModule,
    PayoutsModule,
    DisputesModule,
    GigsModule,
    SecurityModule,
    MarketingModule,
    PublicModule,
    ProductsModule,
    SupportModule,
    CreditsModule,
    CredentialsModule,
    ChallengesModule,
    ResumesModule,
    JobCreatorModule,
    TalentPoolsModule,
    OutreachModule,
    ExpertSearchModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
