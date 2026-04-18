-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('GENERATED', 'BOOKMARKED', 'DEVELOPING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('INDEPENDENT_VAR', 'DEPENDENT_VAR', 'MEDIATOR', 'MODERATOR', 'CONTROL_VAR');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('DIRECT_EFFECT', 'MEDIATION', 'MODERATION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "domain" TEXT,
    "notebookUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "externalId" TEXT,
    "doi" TEXT,
    "title" TEXT NOT NULL,
    "abstract" TEXT,
    "authors" JSONB NOT NULL,
    "year" INTEGER,
    "venue" TEXT,
    "citationCount" INTEGER NOT NULL DEFAULT 0,
    "referenceCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "openAccessPdf" TEXT,
    "fieldsOfStudy" JSONB,
    "rawMetadata" JSONB,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Paper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperCluster" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "clusterId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "PaperCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiteratureReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "themes" JSONB NOT NULL,
    "timeline" JSONB,
    "gaps" JSONB NOT NULL,
    "directions" JSONB,
    "fullText" TEXT NOT NULL,
    "paperIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteratureReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchIdea" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "theory" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "contribution" TEXT NOT NULL,
    "noveltyScore" DOUBLE PRECISION,
    "feasibilityScore" DOUBLE PRECISION,
    "impactScore" DOUBLE PRECISION,
    "evaluation" JSONB,
    "similarPapers" JSONB,
    "status" "IdeaStatus" NOT NULL DEFAULT 'GENERATED',
    "userNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphNode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "aliases" JSONB,
    "nodeType" "NodeType" NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relationType" "RelationType" NOT NULL,
    "direction" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "supportPapers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariableRelation" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "independentVar" TEXT NOT NULL,
    "dependentVar" TEXT NOT NULL,
    "mediators" JSONB,
    "moderators" JSONB,
    "direction" TEXT,
    "effectSize" TEXT,
    "sampleContext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VariableRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Theory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coreConstructs" JSONB NOT NULL,
    "assumptions" JSONB,
    "boundaries" JSONB,
    "seminalPapers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Theory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTheory" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "theoryId" TEXT NOT NULL,
    "usage" TEXT,

    CONSTRAINT "PaperTheory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Paper_projectId_year_idx" ON "Paper"("projectId", "year");

-- CreateIndex
CREATE INDEX "Paper_projectId_citationCount_idx" ON "Paper"("projectId", "citationCount");

-- CreateIndex
CREATE UNIQUE INDEX "Paper_projectId_doi_key" ON "Paper"("projectId", "doi");

-- CreateIndex
CREATE UNIQUE INDEX "Paper_projectId_externalId_key" ON "Paper"("projectId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperCluster_paperId_key" ON "PaperCluster"("paperId");

-- CreateIndex
CREATE UNIQUE INDEX "GraphNode_projectId_label_key" ON "GraphNode"("projectId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "GraphEdge_projectId_fromNodeId_toNodeId_relationType_key" ON "GraphEdge"("projectId", "fromNodeId", "toNodeId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "Theory_projectId_name_key" ON "Theory"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PaperTheory_paperId_theoryId_key" ON "PaperTheory"("paperId", "theoryId");

-- AddForeignKey
ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paper" ADD CONSTRAINT "Paper_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperCluster" ADD CONSTRAINT "PaperCluster_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiteratureReview" ADD CONSTRAINT "LiteratureReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchIdea" ADD CONSTRAINT "ResearchIdea_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphNode" ADD CONSTRAINT "GraphNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariableRelation" ADD CONSTRAINT "VariableRelation_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theory" ADD CONSTRAINT "Theory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTheory" ADD CONSTRAINT "PaperTheory_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTheory" ADD CONSTRAINT "PaperTheory_theoryId_fkey" FOREIGN KEY ("theoryId") REFERENCES "Theory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
