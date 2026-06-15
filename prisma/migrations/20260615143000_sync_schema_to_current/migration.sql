-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN "companyDisplayName" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "confirmation_records";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "trade_listing_uploads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "reportingFiscalYear" INTEGER NOT NULL,
    "reportingFiscalQuarter" INTEGER NOT NULL,
    "rowCountImported" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trade_listing_uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "entity_contacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sapCustomerCode" TEXT,
    "projectName" TEXT,
    "region" TEXT,
    "payeeName" TEXT,
    "billingCompany" TEXT,
    "personName" TEXT,
    "emailTo" TEXT NOT NULL DEFAULT '',
    "emailCc" TEXT,
    "source" TEXT NOT NULL DEFAULT 'rt_india_sheet1',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "vendor_masters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "normalizedKey" TEXT NOT NULL,
    "companyCode" TEXT NOT NULL,
    "partyName" TEXT NOT NULL DEFAULT '',
    "custId" TEXT,
    "emailTo" TEXT NOT NULL DEFAULT '',
    "emailCc" TEXT,
    "projectName" TEXT,
    "region" TEXT,
    "personName" TEXT,
    "sapCustomerCode" TEXT,
    "source" TEXT NOT NULL DEFAULT 'listing',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "supplier_masters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "normalizedKey" TEXT NOT NULL,
    "companyCode" TEXT NOT NULL,
    "partyName" TEXT NOT NULL DEFAULT '',
    "custId" TEXT,
    "emailTo" TEXT NOT NULL DEFAULT '',
    "emailCc" TEXT,
    "projectName" TEXT,
    "region" TEXT,
    "personName" TEXT,
    "sapCustomerCode" TEXT,
    "source" TEXT NOT NULL DEFAULT 'listing',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "trade_payable_confirmations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityContactId" TEXT,
    "vendorMasterId" TEXT,
    "entityName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Trade Payables',
    "bankName" TEXT,
    "accountNumber" TEXT,
    "custId" TEXT,
    "documentDate" TEXT,
    "documentNumber" TEXT,
    "currencyValue" TEXT,
    "reportingFiscalYear" INTEGER,
    "reportingFiscalQuarter" INTEGER,
    "listingUploadId" TEXT,
    "emailThreadAnchorId" TEXT,
    "emailTo" TEXT NOT NULL,
    "emailCc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_sent',
    "sentAt" DATETIME,
    "sentMessageId" TEXT,
    "sentEmailFilePath" TEXT,
    "followupSentAt" DATETIME,
    "followupMessageId" TEXT,
    "followupEmailFilePath" TEXT,
    "followupCount" INTEGER NOT NULL DEFAULT 0,
    "followupsJson" TEXT,
    "responseReceivedAt" DATETIME,
    "responseMessageId" TEXT,
    "responseSubject" TEXT,
    "responseBody" TEXT,
    "responseHtmlBody" TEXT,
    "responseFromEmail" TEXT,
    "responseFromName" TEXT,
    "responseEmailFilePath" TEXT,
    "responseHasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "responseAttachmentsJson" TEXT,
    "responsesJson" TEXT,
    "attachmentPath" TEXT,
    "attachmentName" TEXT,
    "emailsSentFolderPath" TEXT,
    "responsesFolderPath" TEXT,
    "remarks" TEXT,
    "emailActionNonce" TEXT,
    "emailActionConsumedAt" DATETIME,
    "webConfirmedAt" DATETIME,
    "respondentQueryJson" TEXT,
    "userId" TEXT NOT NULL,
    "emailConfigId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "trade_payable_confirmations_entityContactId_fkey" FOREIGN KEY ("entityContactId") REFERENCES "entity_contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trade_payable_confirmations_vendorMasterId_fkey" FOREIGN KEY ("vendorMasterId") REFERENCES "vendor_masters" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trade_payable_confirmations_listingUploadId_fkey" FOREIGN KEY ("listingUploadId") REFERENCES "trade_listing_uploads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trade_payable_confirmations_emailThreadAnchorId_fkey" FOREIGN KEY ("emailThreadAnchorId") REFERENCES "trade_payable_confirmations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "trade_receivable_confirmations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityContactId" TEXT,
    "supplierMasterId" TEXT,
    "entityName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Trade Receivables',
    "bankName" TEXT,
    "accountNumber" TEXT,
    "custId" TEXT,
    "documentDate" TEXT,
    "documentNumber" TEXT,
    "currencyValue" TEXT,
    "reportingFiscalYear" INTEGER,
    "reportingFiscalQuarter" INTEGER,
    "listingUploadId" TEXT,
    "emailThreadAnchorId" TEXT,
    "emailTo" TEXT NOT NULL,
    "emailCc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_sent',
    "sentAt" DATETIME,
    "sentMessageId" TEXT,
    "sentEmailFilePath" TEXT,
    "followupSentAt" DATETIME,
    "followupMessageId" TEXT,
    "followupEmailFilePath" TEXT,
    "followupCount" INTEGER NOT NULL DEFAULT 0,
    "followupsJson" TEXT,
    "responseReceivedAt" DATETIME,
    "responseMessageId" TEXT,
    "responseSubject" TEXT,
    "responseBody" TEXT,
    "responseHtmlBody" TEXT,
    "responseFromEmail" TEXT,
    "responseFromName" TEXT,
    "responseEmailFilePath" TEXT,
    "responseHasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "responseAttachmentsJson" TEXT,
    "responsesJson" TEXT,
    "attachmentPath" TEXT,
    "attachmentName" TEXT,
    "emailsSentFolderPath" TEXT,
    "responsesFolderPath" TEXT,
    "remarks" TEXT,
    "emailActionNonce" TEXT,
    "emailActionConsumedAt" DATETIME,
    "webConfirmedAt" DATETIME,
    "respondentQueryJson" TEXT,
    "userId" TEXT NOT NULL,
    "emailConfigId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "trade_receivable_confirmations_entityContactId_fkey" FOREIGN KEY ("entityContactId") REFERENCES "entity_contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trade_receivable_confirmations_supplierMasterId_fkey" FOREIGN KEY ("supplierMasterId") REFERENCES "supplier_masters" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trade_receivable_confirmations_listingUploadId_fkey" FOREIGN KEY ("listingUploadId") REFERENCES "trade_listing_uploads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "trade_receivable_confirmations_emailThreadAnchorId_fkey" FOREIGN KEY ("emailThreadAnchorId") REFERENCES "trade_receivable_confirmations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "msme_confirmations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityContactId" TEXT,
    "vendorMasterId" TEXT,
    "supplierMasterId" TEXT,
    "entityName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Confirm MSME',
    "bankName" TEXT,
    "accountNumber" TEXT,
    "custId" TEXT,
    "reportingFiscalYear" INTEGER,
    "reportingFiscalQuarter" INTEGER,
    "emailTo" TEXT NOT NULL,
    "emailCc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_sent',
    "sentAt" DATETIME,
    "sentMessageId" TEXT,
    "sentEmailFilePath" TEXT,
    "followupSentAt" DATETIME,
    "followupMessageId" TEXT,
    "followupEmailFilePath" TEXT,
    "followupCount" INTEGER NOT NULL DEFAULT 0,
    "followupsJson" TEXT,
    "responseReceivedAt" DATETIME,
    "responseMessageId" TEXT,
    "responseSubject" TEXT,
    "responseBody" TEXT,
    "responseHtmlBody" TEXT,
    "responseFromEmail" TEXT,
    "responseFromName" TEXT,
    "responseEmailFilePath" TEXT,
    "responseHasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "responseAttachmentsJson" TEXT,
    "responsesJson" TEXT,
    "attachmentPath" TEXT,
    "attachmentName" TEXT,
    "emailsSentFolderPath" TEXT,
    "responsesFolderPath" TEXT,
    "remarks" TEXT,
    "emailActionNonce" TEXT,
    "emailActionConsumedAt" DATETIME,
    "webConfirmedAt" DATETIME,
    "respondentQueryJson" TEXT,
    "msmeHasCertificate" BOOLEAN,
    "msmeCertificateFilesJson" TEXT,
    "userId" TEXT NOT NULL,
    "emailConfigId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "msme_confirmations_entityContactId_fkey" FOREIGN KEY ("entityContactId") REFERENCES "entity_contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "msme_confirmations_vendorMasterId_fkey" FOREIGN KEY ("vendorMasterId") REFERENCES "vendor_masters" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "msme_confirmations_supplierMasterId_fkey" FOREIGN KEY ("supplierMasterId") REFERENCES "supplier_masters" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "email_body_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "moduleKey" TEXT,
    "category" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'initial',
    "subjectTemplate" TEXT,
    "htmlBody" TEXT NOT NULL,
    "plainBody" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "email_body_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "accessTradePayable" BOOLEAN NOT NULL DEFAULT true,
    "accessTradeReceivable" BOOLEAN NOT NULL DEFAULT true,
    "accessConfirmMsme" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lockoutCount" INTEGER NOT NULL DEFAULT 0,
    "adminResetRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_users" ("createdAt", "email", "failedLoginAttempts", "id", "lockedUntil", "name", "password", "updatedAt", "username") SELECT "createdAt", "email", "failedLoginAttempts", "id", "lockedUntil", "name", "password", "updatedAt", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "trade_listing_uploads_userId_idx" ON "trade_listing_uploads"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_contacts_sapCustomerCode_key" ON "entity_contacts"("sapCustomerCode");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_masters_normalizedKey_key" ON "vendor_masters"("normalizedKey");

-- CreateIndex
CREATE INDEX "vendor_masters_custId_idx" ON "vendor_masters"("custId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_masters_normalizedKey_key" ON "supplier_masters"("normalizedKey");

-- CreateIndex
CREATE INDEX "supplier_masters_custId_idx" ON "supplier_masters"("custId");

-- CreateIndex
CREATE INDEX "trade_payable_confirmations_entityContactId_idx" ON "trade_payable_confirmations"("entityContactId");

-- CreateIndex
CREATE INDEX "trade_payable_confirmations_vendorMasterId_idx" ON "trade_payable_confirmations"("vendorMasterId");

-- CreateIndex
CREATE INDEX "trade_payable_confirmations_custId_idx" ON "trade_payable_confirmations"("custId");

-- CreateIndex
CREATE INDEX "trade_payable_confirmations_listingUploadId_idx" ON "trade_payable_confirmations"("listingUploadId");

-- CreateIndex
CREATE INDEX "trade_payable_confirmations_emailThreadAnchorId_idx" ON "trade_payable_confirmations"("emailThreadAnchorId");

-- CreateIndex
CREATE INDEX "trade_receivable_confirmations_entityContactId_idx" ON "trade_receivable_confirmations"("entityContactId");

-- CreateIndex
CREATE INDEX "trade_receivable_confirmations_supplierMasterId_idx" ON "trade_receivable_confirmations"("supplierMasterId");

-- CreateIndex
CREATE INDEX "trade_receivable_confirmations_custId_idx" ON "trade_receivable_confirmations"("custId");

-- CreateIndex
CREATE INDEX "trade_receivable_confirmations_listingUploadId_idx" ON "trade_receivable_confirmations"("listingUploadId");

-- CreateIndex
CREATE INDEX "trade_receivable_confirmations_emailThreadAnchorId_idx" ON "trade_receivable_confirmations"("emailThreadAnchorId");

-- CreateIndex
CREATE INDEX "msme_confirmations_entityContactId_idx" ON "msme_confirmations"("entityContactId");

-- CreateIndex
CREATE INDEX "msme_confirmations_vendorMasterId_idx" ON "msme_confirmations"("vendorMasterId");

-- CreateIndex
CREATE INDEX "msme_confirmations_supplierMasterId_idx" ON "msme_confirmations"("supplierMasterId");

-- CreateIndex
CREATE INDEX "msme_confirmations_custId_idx" ON "msme_confirmations"("custId");

-- CreateIndex
CREATE UNIQUE INDEX "email_body_templates_slug_key" ON "email_body_templates"("slug");

-- CreateIndex
CREATE INDEX "email_body_templates_moduleKey_purpose_idx" ON "email_body_templates"("moduleKey", "purpose");

