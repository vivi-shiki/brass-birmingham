import {createHash} from 'node:crypto';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  FACE_AUDIT_AREAS,
  buildFaceAuditAreaReviewTemplate,
  buildFaceAuditAreaReviewSheet,
  buildFaceAuditLockArtifact,
  buildFaceAuditReviewerHandoff,
  buildFaceAuditReviewSheet,
  buildFaceAuditReviewTemplate,
  type FaceAuditArea,
} from '../src/common/faceAudit';
import {runFaceAuditCli, type FaceAuditCliIO} from '../src/tools/faceAuditCli';

const SHA256_CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;

function ciFileSummary(path: string, artifactType: string, ok = true) {
  return {
    path,
    artifactType,
    ok,
    contentHash: expect.stringMatching(SHA256_CONTENT_HASH),
  };
}

function sha256TextContentHash(text: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

class MemoryFaceAuditCliIO implements FaceAuditCliIO {
  directories = new Set<string>();
  removedDirectories = new Set<string>();
  stdout = '';
  stderr = '';
  private nextTempDirectoryId = 1;

  constructor(private readonly files: Record<string, string | Uint8Array> = {}) {}

  async makeDirectory(dirPath: string): Promise<void> {
    this.directories.add(dirPath);
  }

  async makeTempDirectory(prefix: string): Promise<string> {
    const dirPath = path.join('tmp', `${prefix}${this.nextTempDirectoryId}`);
    this.nextTempDirectoryId++;
    this.directories.add(dirPath);
    return dirPath;
  }

  async removeDirectory(dirPath: string): Promise<void> {
    this.directories.delete(dirPath);
    this.removedDirectories.add(dirPath);
    for (const filePath of Object.keys(this.files)) {
      if (filePath === dirPath || filePath.startsWith(`${dirPath}${path.sep}`)) {
        delete this.files[filePath];
      }
    }
  }

  async readBinaryFile(filePath: string): Promise<Uint8Array> {
    const content = this.files[filePath];
    if (content === undefined) {
      throw new Error(`Missing file ${filePath}`);
    }
    return typeof content === 'string' ? Buffer.from(content) : content;
  }

  async readTextFile(filePath: string): Promise<string> {
    const content = this.files[filePath];
    if (content === undefined) {
      throw new Error(`Missing file ${filePath}`);
    }
    return typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
  }

  async writeTextFile(filePath: string, text: string): Promise<void> {
    this.files[filePath] = text;
  }

  writeStdout(text: string): void {
    this.stdout += text;
  }

  writeStderr(text: string): void {
    this.stderr += text;
  }

  textFile(filePath: string): string {
    const content = this.files[filePath];
    if (typeof content !== 'string') {
      throw new Error(`Missing text file ${filePath}`);
    }
    return content;
  }
}

function filledReviewArtifact(): ReturnType<typeof buildFaceAuditReviewTemplate> {
  const template = buildFaceAuditReviewTemplate();
  return {
    ...template,
    evidenceSources: [{
      id: 'photo-set',
      label: 'Official component photo set',
      sourceType: 'official_physical_component',
      citation: 'Reviewer-owned official Brass: Birmingham component photos',
      locator: 'reviewer-photos/official-component-set.zip',
      notes: '',
    }],
    items: template.items.map((item) => ({
      ...item,
      reviewStatus: 'matches_official_face',
      reviewer: 'Ada',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      evidenceRef: `official-component:photo-set#${item.area}`,
    })),
  };
}

function filledAreaReviewArtifact(area: FaceAuditArea): ReturnType<typeof buildFaceAuditAreaReviewTemplate> {
  const template = buildFaceAuditAreaReviewTemplate(area);
  return {
    ...template,
    evidenceSources: [{
      id: 'photo-set',
      label: 'Official component photo set',
      sourceType: 'official_physical_component',
      citation: 'Reviewer-owned official Brass: Birmingham component photos',
      locator: 'reviewer-photos/official-component-set.zip',
      notes: '',
    }],
    items: template.items.map((item) => ({
      ...item,
      reviewStatus: 'matches_official_face',
      reviewer: 'Ada',
      reviewedAt: '2026-07-10T00:00:00.000Z',
      evidenceRef: `official-component:photo-set#${item.area}`,
    })),
  };
}

function evidenceSourceTemplateArtifact() {
  return {
    artifactType: 'face_audit_evidence_source_template',
    version: 1,
    sourceType: 'official_high_res_component_image',
    sourceCount: 1,
    evidenceSources: [{
      id: 'photo-set',
      label: 'official-components.zip',
      sourceType: 'official_high_res_component_image',
      citation: 'Official Brass: Birmingham component evidence: official-components.zip',
      locator: 'reviewer-photos/official-components.zip',
      contentHash: 'sha256:ed805955cfc9b2ff646db3506535a88b17e7d45e98b91dc73bccb1394bf66c3c',
      notes: '',
    }],
  };
}

describe('face-audit CLI', () => {
  it('prints the versioned checklist artifact as JSON', async () => {
    const io = new MemoryFaceAuditCliIO();

    const exitCode = await runFaceAuditCli(['checklist'], io);
    const checklist = JSON.parse(io.stdout) as {
      version: number;
      checklistFingerprint: string;
      checklistItemCount: number;
      items: unknown[];
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(checklist.version).toBe(1);
    expect(checklist.checklistFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(checklist.checklistItemCount).toBe(185);
    expect(checklist.items).toHaveLength(185);
  });

  it('prints a fillable review template as JSON', async () => {
    const io = new MemoryFaceAuditCliIO();

    const exitCode = await runFaceAuditCli(['template'], io);
    const template = JSON.parse(io.stdout) as ReturnType<typeof buildFaceAuditReviewTemplate>;

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(template.version).toBe(1);
    expect(template.checklistItemCount).toBe(185);
    expect(template.completion.status).toBe('not_started');
    expect(template.items.every((item) => item.reviewStatus === 'unreviewed')).toBe(true);
  });

  it('prints a fillable area review template as JSON', async () => {
    const io = new MemoryFaceAuditCliIO();

    const exitCode = await runFaceAuditCli(['area-template', 'regularCards'], io);
    const template = JSON.parse(io.stdout) as ReturnType<typeof buildFaceAuditAreaReviewTemplate>;

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(template.artifactType).toBe('face_audit_area_review');
    expect(template.area).toBe('regularCards');
    expect(template.checklistItemCount).toBe(185);
    expect(template.areaItemCount).toBe(64);
    expect(template.items).toHaveLength(64);
    expect(template.items.every((item) => item.area === 'regularCards')).toBe(true);

    const invalidIO = new MemoryFaceAuditCliIO();
    const invalidExitCode = await runFaceAuditCli(['area-template', 'unknownArea'], invalidIO);
    expect(invalidExitCode).toBe(2);
    expect(invalidIO.stderr).toContain('Unknown face-audit area: unknownArea');
  });

  it('prints fillable review templates with declared evidence sources without marking items reviewed', async () => {
    const sourceArtifact = evidenceSourceTemplateArtifact();
    const fullIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(sourceArtifact),
    });
    const fullExitCode = await runFaceAuditCli(['template-with-sources', 'sources.json'], fullIO);
    const fullTemplate = JSON.parse(fullIO.stdout) as ReturnType<typeof buildFaceAuditReviewTemplate>;

    expect(fullExitCode).toBe(0);
    expect(fullIO.stderr).toBe('');
    expect(fullTemplate.evidenceSources).toEqual(sourceArtifact.evidenceSources);
    expect(fullTemplate.checklistItemCount).toBe(185);
    expect(fullTemplate.completion.status).toBe('not_started');
    expect(fullTemplate.items.every((item) => item.reviewStatus === 'unreviewed')).toBe(true);
    expect(fullTemplate.items.every((item) =>
      item.reviewer === '' &&
      item.reviewedAt === '' &&
      item.evidenceRef === '' &&
      item.notes === '',
    )).toBe(true);

    const validateIO = new MemoryFaceAuditCliIO({
      'review.json': JSON.stringify(fullTemplate),
    });
    const validateExitCode = await runFaceAuditCli(['validate', 'review.json'], validateIO);
    const validation = JSON.parse(validateIO.stdout) as {ok: boolean; issues: unknown[]};

    expect(validateExitCode).toBe(0);
    expect(validateIO.stderr).toBe('');
    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);

    const areaIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(sourceArtifact),
    });
    const areaExitCode = await runFaceAuditCli(['area-template-with-sources', 'regularCards', 'sources.json'], areaIO);
    const areaTemplate = JSON.parse(areaIO.stdout) as ReturnType<typeof buildFaceAuditAreaReviewTemplate>;

    expect(areaExitCode).toBe(0);
    expect(areaIO.stderr).toBe('');
    expect(areaTemplate.artifactType).toBe('face_audit_area_review');
    expect(areaTemplate.area).toBe('regularCards');
    expect(areaTemplate.evidenceSources).toEqual(sourceArtifact.evidenceSources);
    expect(areaTemplate.areaItemCount).toBe(64);
    expect(areaTemplate.completion.status).toBe('not_started');
    expect(areaTemplate.items.every((item) => item.reviewStatus === 'unreviewed')).toBe(true);
    expect(areaTemplate.items.every((item) => item.evidenceRef === '')).toBe(true);
  });

  it('merges full or area review artifacts into a standard full review artifact', async () => {
    const io = new MemoryFaceAuditCliIO({
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
      'wild.json': JSON.stringify(filledAreaReviewArtifact('wildCards')),
    });

    const exitCode = await runFaceAuditCli(['merge', 'regular.json', 'wild.json'], io);
    const merged = JSON.parse(io.stdout) as ReturnType<typeof buildFaceAuditReviewTemplate>;

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(merged.version).toBe(1);
    expect(merged.checklistItemCount).toBe(185);
    expect(merged.evidenceSources).toHaveLength(1);
    expect(merged.items).toHaveLength(185);
    expect(merged.completion).toMatchObject({
      status: 'in_progress',
      reviewedItemCount: 72,
      unreviewedItemCount: 113,
    });
    expect(merged.areas.find((area) => area.area === 'regularCards')?.reviewCounts.matches_official_face).toBe(64);
    expect(merged.areas.find((area) => area.area === 'wildCards')?.reviewCounts.matches_official_face).toBe(8);

    const missingArgIO = new MemoryFaceAuditCliIO();
    const missingArgExitCode = await runFaceAuditCli(['merge'], missingArgIO);
    expect(missingArgExitCode).toBe(2);
    expect(missingArgIO.stderr).toContain('The merge command expects at least one review artifact JSON file.');
  });

  it('summarizes status for full or area review artifacts', async () => {
    const io = new MemoryFaceAuditCliIO({
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
      'wild.json': JSON.stringify(filledAreaReviewArtifact('wildCards')),
    });

    const exitCode = await runFaceAuditCli(['status', 'regular.json', 'wild.json'], io);
    const report = JSON.parse(io.stdout) as {
      artifactType: string;
      version: number;
      ok: boolean;
      artifactCount: number;
      checklistFingerprint: string;
      reviewFingerprint: string;
      artifactCounts: {
        fullReviewArtifactCount: number;
        areaReviewArtifactCount: number;
        unknownArtifactCount: number;
      };
      evidenceSourceCount: number;
      usedEvidenceSourceCount: number;
      usedEvidenceSourceIds: string[];
      unusedEvidenceSourceCount: number;
      unusedEvidenceSourceIds: string[];
      completion: {
        status: string;
        reviewedItemCount: number;
        unreviewedItemCount: number;
      };
      areaCompletionCounts: {
        not_started: number;
        in_progress: number;
        ready_to_lock: number;
        has_differences: number;
        needs_better_reference: number;
      };
      areaProgress: Array<{
        area: string;
        reviewedItemCount: number;
        matchingItemCount: number;
        unreviewedItemCount: number;
        evidenceRefCount: number;
        areaLevelEvidenceRefCount: number;
        itemSpecificEvidenceRefCount: number;
        itemSpecificEvidenceItemCount: number;
        evidenceSourceIds: string[];
        evidenceRefs: string[];
        reviewers: string[];
        firstReviewedAt: string;
        lastReviewedAt: string;
        differenceItemKeys: string[];
        needsReferenceItemKeys: string[];
        unreviewedItemKeys: string[];
        completionStatus: string;
      }>;
      issueCount: number;
      issues: unknown[];
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(report.artifactType).toBe('face_audit_review_status');
    expect(report.version).toBe(1);
    expect(report.ok).toBe(true);
    expect(report.artifactCount).toBe(2);
    expect(report.checklistFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(report.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(report.artifactCounts).toEqual({
      fullReviewArtifactCount: 0,
      areaReviewArtifactCount: 2,
      unknownArtifactCount: 0,
    });
    expect(report.evidenceSourceCount).toBe(1);
    expect(report.usedEvidenceSourceCount).toBe(1);
    expect(report.usedEvidenceSourceIds).toEqual(['photo-set']);
    expect(report.unusedEvidenceSourceCount).toBe(0);
    expect(report.unusedEvidenceSourceIds).toEqual([]);
    expect(report.completion).toMatchObject({
      status: 'in_progress',
      reviewedItemCount: 72,
      unreviewedItemCount: 113,
    });
    expect(report.areaCompletionCounts).toEqual({
      not_started: 4,
      in_progress: 0,
      ready_to_lock: 2,
      has_differences: 0,
      needs_better_reference: 0,
    });
    expect(report.areaProgress.find((area) => area.area === 'regularCards')).toMatchObject({
      reviewedItemCount: 64,
      matchingItemCount: 64,
      unreviewedItemCount: 0,
      evidenceRefCount: 1,
      areaLevelEvidenceRefCount: 1,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceSourceIds: ['photo-set'],
      evidenceRefs: ['official-component:photo-set#regularCards'],
      reviewers: ['Ada'],
      firstReviewedAt: '2026-07-10T00:00:00.000Z',
      lastReviewedAt: '2026-07-10T00:00:00.000Z',
      differenceItemKeys: [],
      needsReferenceItemKeys: [],
      unreviewedItemKeys: [],
      completionStatus: 'ready_to_lock',
    });
    expect(report.areaProgress.find((area) => area.area === 'wildCards')).toMatchObject({
      reviewedItemCount: 8,
      matchingItemCount: 8,
      unreviewedItemCount: 0,
      evidenceRefCount: 1,
      areaLevelEvidenceRefCount: 1,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceSourceIds: ['photo-set'],
      evidenceRefs: ['official-component:photo-set#wildCards'],
      reviewers: ['Ada'],
      firstReviewedAt: '2026-07-10T00:00:00.000Z',
      lastReviewedAt: '2026-07-10T00:00:00.000Z',
      differenceItemKeys: [],
      needsReferenceItemKeys: [],
      unreviewedItemKeys: [],
      completionStatus: 'ready_to_lock',
    });
    expect(report.areaProgress.find((area) => area.area === 'industryTiles')?.unreviewedItemKeys)
      .toHaveLength(45);
    expect(report.issueCount).toBe(0);
    expect(report.issues).toEqual([]);

    const emptyIO = new MemoryFaceAuditCliIO();
    const emptyExitCode = await runFaceAuditCli(['status'], emptyIO);
    const emptyReport = JSON.parse(emptyIO.stdout) as {
      ok: boolean;
      artifactCount: number;
      evidenceSourceCount: number;
      usedEvidenceSourceCount: number;
      usedEvidenceSourceIds: string[];
      unusedEvidenceSourceCount: number;
      unusedEvidenceSourceIds: string[];
      completion: {
        status: string;
        reviewedItemCount: number;
        unreviewedItemCount: number;
        totalItemCount: number;
      };
      areaCompletionCounts: {
        not_started: number;
        in_progress: number;
        ready_to_lock: number;
        has_differences: number;
        needs_better_reference: number;
      };
      areaProgress: Array<{
        area: string;
        evidenceRefCount: number;
        areaLevelEvidenceRefCount: number;
        itemSpecificEvidenceRefCount: number;
        itemSpecificEvidenceItemCount: number;
        evidenceSourceIds: string[];
        evidenceRefs: string[];
        reviewers: string[];
        firstReviewedAt: string;
        lastReviewedAt: string;
        unreviewedItemKeys: string[];
      }>;
      issueCount: number;
      issues: unknown[];
    };
    expect(emptyExitCode).toBe(0);
    expect(emptyIO.stderr).toBe('');
    expect(emptyReport).toMatchObject({
      ok: true,
      artifactCount: 0,
      evidenceSourceCount: 0,
      usedEvidenceSourceCount: 0,
      usedEvidenceSourceIds: [],
      unusedEvidenceSourceCount: 0,
      unusedEvidenceSourceIds: [],
      completion: {
        status: 'not_started',
        reviewedItemCount: 0,
        unreviewedItemCount: 185,
        totalItemCount: 185,
      },
      issueCount: 0,
      issues: [],
    });
    expect(emptyReport.areaCompletionCounts).toEqual({
      not_started: 6,
      in_progress: 0,
      ready_to_lock: 0,
      has_differences: 0,
      needs_better_reference: 0,
    });
    expect(emptyReport.areaProgress.find((area) => area.area === 'regularCards')).toMatchObject({
      evidenceRefCount: 0,
      areaLevelEvidenceRefCount: 0,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
      evidenceSourceIds: [],
      evidenceRefs: [],
      reviewers: [],
      firstReviewedAt: '',
      lastReviewedAt: '',
    });
    expect(emptyReport.areaProgress.find((area) => area.area === 'regularCards')?.unreviewedItemKeys)
      .toHaveLength(64);
  });

  it('prints a TSV review sheet for spreadsheet-based face-audit tracking', async () => {
    const io = new MemoryFaceAuditCliIO({
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
    });

    const exitCode = await runFaceAuditCli(['review-sheet', 'regular.json'], io);
    const lines = io.stdout.trimEnd().split('\n');
    const firstRegularRow = lines.find((line) => line.includes('\tregularCards:p4-industry-brewery-1\t'));
    const firstIndustryRow = lines.find((line) => line.includes('\tindustryTiles:brewery-1-1\t'));

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(lines).toHaveLength(186);
    expect(lines[0]).toBe('area\titemId\titemKey\tlabel\texpectedFields\treviewStatus\tnextStep\treviewer\treviewedAt\tevidenceRef\tnotes');
    expect(firstRegularRow?.split('\t')).toMatchObject([
      'regularCards',
      'p4-industry-brewery-1',
      'regularCards:p4-industry-brewery-1',
      expect.any(String),
      expect.any(String),
      'matches_official_face',
      '',
      'Ada',
      '2026-07-10T00:00:00.000Z',
      'official-component:photo-set#regularCards',
      '',
    ]);
    expect(firstIndustryRow?.split('\t')[6]).toBe('review_unreviewed_items');

    const invalidIO = new MemoryFaceAuditCliIO();
    const invalidExitCode = await runFaceAuditCli(['review-sheet', 'missing.json'], invalidIO);
    expect(invalidExitCode).toBe(2);
    expect(invalidIO.stderr).toContain('Could not read a valid review artifact JSON file');
  });

  it('prints an area TSV review sheet for split face-audit tracking', async () => {
    const io = new MemoryFaceAuditCliIO({
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
    });

    const exitCode = await runFaceAuditCli(['area-review-sheet', 'regularCards', 'regular.json'], io);
    const expectedSheet = buildFaceAuditAreaReviewSheet([
      filledAreaReviewArtifact('regularCards'),
    ], 'regularCards');
    const lines = io.stdout.trimEnd().split('\n');

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(io.stdout).toBe(expectedSheet.tsv);
    expect(lines).toHaveLength(65);
    expect(lines[0]).toBe('area\titemId\titemKey\tlabel\texpectedFields\treviewStatus\tnextStep\treviewer\treviewedAt\tevidenceRef\tnotes');
    expect(lines.slice(1).every((line) => line.startsWith('regularCards\t'))).toBe(true);

    const unknownAreaIO = new MemoryFaceAuditCliIO();
    const unknownAreaExitCode = await runFaceAuditCli(['area-review-sheet', 'badArea'], unknownAreaIO);
    expect(unknownAreaExitCode).toBe(2);
    expect(unknownAreaIO.stderr).toContain('Unknown face-audit area: badArea');

    const invalidIO = new MemoryFaceAuditCliIO();
    const invalidExitCode = await runFaceAuditCli(['area-review-sheet', 'regularCards', 'missing.json'], invalidIO);
    expect(invalidExitCode).toBe(2);
    expect(invalidIO.stderr).toContain('Could not read a valid review artifact JSON file');
  });

  it('applies an edited TSV review sheet back into full review JSON', async () => {
    const baseline = filledAreaReviewArtifact('regularCards');
    const sheet = buildFaceAuditReviewSheet([baseline]);
    const lines = sheet.tsv.endsWith('\n')
      ? sheet.tsv.slice(0, -1).split('\n')
      : sheet.tsv.split('\n');
    const industryRowIndex = lines.findIndex((line) => line.includes('\tindustryTiles:brewery-1-1\t'));
    if (industryRowIndex < 1) {
      throw new Error('Missing industryTiles TSV row');
    }
    const cells = lines[industryRowIndex]!.split('\t');
    cells[5] = 'matches_official_face';
    cells[6] = '';
    cells[7] = 'Ben';
    cells[8] = '2026-07-10T02:00:00.000Z';
    cells[9] = 'official-component:photo-set#industryTiles:brewery-1-1';
    lines[industryRowIndex] = cells.join('\t');

    const io = new MemoryFaceAuditCliIO({
      'review-sheet.tsv': `${lines.join('\n')}\n`,
      'regular.json': JSON.stringify(baseline),
    });

    const exitCode = await runFaceAuditCli(['apply-review-sheet', 'review-sheet.tsv', 'regular.json'], io);
    const review = JSON.parse(io.stdout) as ReturnType<typeof buildFaceAuditReviewTemplate>;
    const importedItem = review.items.find((item) => item.key === 'industryTiles:brewery-1-1');

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(review.version).toBe(1);
    expect(review.evidenceSources).toEqual(baseline.evidenceSources);
    expect(importedItem).toMatchObject({
      reviewStatus: 'matches_official_face',
      reviewer: 'Ben',
      reviewedAt: '2026-07-10T02:00:00.000Z',
      evidenceRef: 'official-component:photo-set#industryTiles:brewery-1-1',
    });

    const invalidSheetIO = new MemoryFaceAuditCliIO({
      'bad.tsv': sheet.tsv.replace('itemKey', 'badItemKey'),
      'regular.json': JSON.stringify(baseline),
    });
    const invalidSheetExitCode = await runFaceAuditCli(['apply-review-sheet', 'bad.tsv', 'regular.json'], invalidSheetIO);
    const invalidReport = JSON.parse(invalidSheetIO.stdout) as {
      artifactType: string;
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };
    expect(invalidSheetExitCode).toBe(1);
    expect(invalidSheetIO.stderr).toBe('');
    expect(invalidReport.artifactType).toBe('face_audit_review_sheet_import');
    expect(invalidReport.ok).toBe(false);
    expect(invalidReport.issues).toContainEqual({
      field: 'reviewSheet.header',
      message: 'Face-audit review sheet header must match the exported TSV columns',
    });

    const missingSheetIO = new MemoryFaceAuditCliIO();
    const missingSheetExitCode = await runFaceAuditCli(['apply-review-sheet'], missingSheetIO);
    expect(missingSheetExitCode).toBe(2);
    expect(missingSheetIO.stderr)
      .toContain('The apply-review-sheet command expects a review sheet TSV file and optional review artifact JSON files.');
  });

  it('prints a compact todo handoff for unfinished face-audit areas', async () => {
    const io = new MemoryFaceAuditCliIO({
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
      'wild.json': JSON.stringify(filledAreaReviewArtifact('wildCards')),
    });

    const exitCode = await runFaceAuditCli(['todo', 'regular.json', 'wild.json'], io);
    const todo = JSON.parse(io.stdout) as {
      artifactType: string;
      version: number;
      ok: boolean;
      artifactCount: number;
      checklistFingerprint: string;
      reviewFingerprint: string;
      checklistItemCount: number;
      pendingAreaCount: number;
      readyAreaCount: number;
      completion: {
        status: string;
        reviewedItemCount: number;
        unreviewedItemCount: number;
      };
      areas: Array<{
        area: string;
        completionStatus: string;
        nextStep: string;
        remainingItemCount: number;
        nextItemKeys: string[];
        commands: {
          blankTemplate: string;
          blankTemplateWithSources: string;
          areaMatchTemplate: string;
          areaMatchTemplateWithItemRefs: string;
        };
      }>;
      issueCount: number;
      issues: unknown[];
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(todo.artifactType).toBe('face_audit_review_todo');
    expect(todo.version).toBe(1);
    expect(todo.ok).toBe(true);
    expect(todo.artifactCount).toBe(2);
    expect(todo.checklistFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(todo.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(todo.checklistItemCount).toBe(185);
    expect(todo.pendingAreaCount).toBe(4);
    expect(todo.readyAreaCount).toBe(2);
    expect(todo.completion).toMatchObject({
      status: 'in_progress',
      reviewedItemCount: 72,
      unreviewedItemCount: 113,
    });
    expect(todo.areas.map((area) => area.area)).not.toContain('regularCards');
    expect(todo.areas.map((area) => area.area)).not.toContain('wildCards');
    expect(todo.areas.find((area) => area.area === 'industryTiles')).toMatchObject({
      completionStatus: 'not_started',
      nextStep: 'review_unreviewed_items',
      remainingItemCount: 45,
      commands: {
        blankTemplate: 'npm run face-audit:area-template -- industryTiles',
        blankTemplateWithSources: 'npm run face-audit:area-template-with-sources -- industryTiles .\\path\\to\\evidence-sources.json',
        areaMatchTemplate: 'npm run face-audit:area-match-template -- industryTiles .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at>',
        areaMatchTemplateWithItemRefs: 'npm run face-audit:area-match-template -- industryTiles .\\path\\to\\evidence-sources.json <source-id> <reviewer> <reviewed-at> items',
      },
    });
    expect(todo.areas.find((area) => area.area === 'industryTiles')?.nextItemKeys).toHaveLength(10);
    expect(todo.issueCount).toBe(0);
    expect(todo.issues).toEqual([]);
  });

  it('prints a count-only todo summary without requiring reviewers to inspect the full handoff JSON', async () => {
    const files = {
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
      'wild.json': JSON.stringify(filledAreaReviewArtifact('wildCards')),
    };
    const io = new MemoryFaceAuditCliIO(files);

    const exitCode = await runFaceAuditCli(['todo', '--summary', 'regular.json', 'wild.json'], io);
    const summary = JSON.parse(io.stdout) as {
      artifactType: string;
      version: number;
      ok: boolean;
      artifactCount: number;
      checklistItemCount: number;
      pendingAreaCount: number;
      readyAreaCount: number;
      pendingItemCount: number;
      unfinishedAreas: Array<{
        area: string;
        completionStatus: string;
        nextStep: string;
        remainingItemCount: number;
      }>;
      issueCount: number;
      issues: unknown[];
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(summary).toMatchObject({
      artifactType: 'face_audit_review_todo_summary',
      version: 1,
      ok: true,
      artifactCount: 2,
      checklistItemCount: 185,
      pendingAreaCount: 4,
      readyAreaCount: 2,
      pendingItemCount: 113,
      issueCount: 0,
      issues: [],
    });
    expect(summary.unfinishedAreas).toEqual([
      {area: 'industryTiles', completionStatus: 'not_started', nextStep: 'review_unreviewed_items', remainingItemCount: 45},
      {area: 'linkLines', completionStatus: 'not_started', nextStep: 'review_unreviewed_items', remainingItemCount: 39},
      {area: 'locationsAndSlots', completionStatus: 'not_started', nextStep: 'review_unreviewed_items', remainingItemCount: 20},
      {area: 'merchantTiles', completionStatus: 'not_started', nextStep: 'review_unreviewed_items', remainingItemCount: 9},
    ]);
    expect(io.stdout).not.toContain('blankTemplate');

    const trailingOptionIO = new MemoryFaceAuditCliIO(files);
    const trailingOptionExitCode = await runFaceAuditCli(['todo', 'regular.json', '--summary', 'wild.json'], trailingOptionIO);
    expect(trailingOptionExitCode).toBe(0);
    expect(JSON.parse(trailingOptionIO.stdout)).toEqual(summary);

    const areaIO = new MemoryFaceAuditCliIO(files);
    const areaExitCode = await runFaceAuditCli(['todo', '--summary', '--area', 'industryTiles', 'regular.json', 'wild.json'], areaIO);
    const areaSummary = JSON.parse(areaIO.stdout) as {
      artifactType: string;
      ok: boolean;
      artifactCount: number;
      area: string;
      itemCount: number;
      completionStatus: string;
      nextStep: string;
      pendingItemCount: number;
      remainingItemCount: number;
      reviewedItemCount: number;
      unreviewedItemCount: number;
      issueCount: number;
      issues: unknown[];
    };
    expect(areaExitCode).toBe(0);
    expect(areaIO.stderr).toBe('');
    expect(areaSummary).toMatchObject({
      artifactType: 'face_audit_area_review_todo_summary',
      ok: true,
      artifactCount: 2,
      area: 'industryTiles',
      itemCount: 45,
      completionStatus: 'not_started',
      nextStep: 'review_unreviewed_items',
      pendingItemCount: 45,
      remainingItemCount: 45,
      reviewedItemCount: 0,
      unreviewedItemCount: 45,
      issueCount: 0,
      issues: [],
    });
    expect(areaIO.stdout).not.toContain('blankTemplate');

    const readyAreaIO = new MemoryFaceAuditCliIO(files);
    const readyAreaExitCode = await runFaceAuditCli(['todo', '--summary', '--area=wildCards', 'regular.json', 'wild.json'], readyAreaIO);
    expect(readyAreaExitCode).toBe(0);
    expect(JSON.parse(readyAreaIO.stdout)).toMatchObject({
      artifactType: 'face_audit_area_review_todo_summary',
      area: 'wildCards',
      completionStatus: 'ready_to_lock',
      nextStep: 'none',
      pendingItemCount: 0,
      remainingItemCount: 0,
      reviewedItemCount: 8,
      matchingItemCount: 8,
    });

    const areaWithoutSummaryIO = new MemoryFaceAuditCliIO(files);
    const areaWithoutSummaryExitCode = await runFaceAuditCli(['todo', '--area', 'wildCards'], areaWithoutSummaryIO);
    expect(areaWithoutSummaryExitCode).toBe(2);
    expect(areaWithoutSummaryIO.stdout).toBe('');
    expect(areaWithoutSummaryIO.stderr).toContain('The todo --area option requires --summary.');

    const missingAreaIO = new MemoryFaceAuditCliIO(files);
    const missingAreaExitCode = await runFaceAuditCli(['todo', '--summary', '--area'], missingAreaIO);
    expect(missingAreaExitCode).toBe(2);
    expect(missingAreaIO.stdout).toBe('');
    expect(missingAreaIO.stderr).toContain('The todo --area option expects one face-audit area.');

    const invalidAreaIO = new MemoryFaceAuditCliIO(files);
    const invalidAreaExitCode = await runFaceAuditCli(['todo', '--summary', '--area', 'unknownArea'], invalidAreaIO);
    expect(invalidAreaExitCode).toBe(2);
    expect(invalidAreaIO.stdout).toBe('');
    expect(invalidAreaIO.stderr).toContain('Unknown face-audit area: unknownArea');

    const invalidOptionIO = new MemoryFaceAuditCliIO();
    const invalidOptionExitCode = await runFaceAuditCli(['todo', '--unknown'], invalidOptionIO);
    expect(invalidOptionExitCode).toBe(2);
    expect(invalidOptionIO.stdout).toBe('');
    expect(invalidOptionIO.stderr).toContain('The todo command does not accept option: --unknown');
  });

  it('prints a reviewer plan with every unfinished face-audit item', async () => {
    const io = new MemoryFaceAuditCliIO({
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
      'wild.json': JSON.stringify(filledAreaReviewArtifact('wildCards')),
    });

    const exitCode = await runFaceAuditCli(['review-plan', 'regular.json', 'wild.json'], io);
    const plan = JSON.parse(io.stdout) as {
      artifactType: string;
      version: number;
      ok: boolean;
      artifactCount: number;
      checklistFingerprint: string;
      reviewFingerprint: string;
      checklistItemCount: number;
      pendingAreaCount: number;
      readyAreaCount: number;
      pendingItemCount: number;
      areas: Array<{
        area: string;
        remainingItemCount: number;
        items: Array<{
          key: string;
          id: string;
          label: string;
          expectedFields: string[];
          reviewStatus: string;
          nextStep: string;
          evidenceRef: string;
          notes: string;
        }>;
      }>;
      issueCount: number;
      issues: unknown[];
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(plan.artifactType).toBe('face_audit_review_plan');
    expect(plan.version).toBe(1);
    expect(plan.ok).toBe(true);
    expect(plan.artifactCount).toBe(2);
    expect(plan.checklistFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(plan.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(plan.checklistItemCount).toBe(185);
    expect(plan.pendingAreaCount).toBe(4);
    expect(plan.readyAreaCount).toBe(2);
    expect(plan.pendingItemCount).toBe(113);
    expect(plan.areas.map((area) => area.area)).not.toContain('regularCards');
    expect(plan.areas.map((area) => area.area)).not.toContain('wildCards');
    const industryPlan = plan.areas.find((area) => area.area === 'industryTiles');
    expect(industryPlan).toMatchObject({remainingItemCount: 45});
    expect(industryPlan?.items).toHaveLength(45);
    expect(industryPlan?.items[0]).toMatchObject({
      key: 'industryTiles:brewery-1-1',
      id: 'brewery-1-1',
      reviewStatus: 'unreviewed',
      nextStep: 'review_unreviewed_items',
      evidenceRef: '',
      notes: '',
    });
    expect(plan.issueCount).toBe(0);
    expect(plan.issues).toEqual([]);

    const invalidIO = new MemoryFaceAuditCliIO();
    const invalidExitCode = await runFaceAuditCli(['review-plan', 'missing.json'], invalidIO);
    expect(invalidExitCode).toBe(2);
    expect(invalidIO.stdout).toBe('');
    expect(invalidIO.stderr).toContain('Could not read a valid review artifact JSON file');
  });

  it('prints reviewer instructions markdown from review artifacts', async () => {
    const io = new MemoryFaceAuditCliIO({
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
      'wild.json': JSON.stringify(filledAreaReviewArtifact('wildCards')),
    });

    const exitCode = await runFaceAuditCli(['reviewer-instructions', 'regular.json', 'wild.json'], io);

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(io.stdout).toContain('# Face Audit Reviewer Instructions');
    expect(io.stdout).toContain('- Progress: 72 / 185 reviewed; 113 unreviewed');
    expect(io.stdout).toContain('- Areas: 4 pending, 2 ready');
    expect(io.stdout)
      .toContain('- `industryTiles`: 45 item(s), next step `review_unreviewed_items`, file `face-audit-area-industryTiles-review.json`');
    expect(io.stdout)
      .toContain('- Verify this handoff package: `npm run face-audit:verify-handoff -- .\\face-audit-reviewer-handoff.json`');
    expect(io.stdout).toMatch(/\n$/);

    const invalidIO = new MemoryFaceAuditCliIO();
    const invalidExitCode = await runFaceAuditCli(['reviewer-instructions', 'missing.json'], invalidIO);
    expect(invalidExitCode).toBe(2);
    expect(invalidIO.stdout).toBe('');
    expect(invalidIO.stderr).toContain('Could not read a valid review artifact JSON file');
  });

  it('prints area-specific reviewer instructions markdown from review artifacts', async () => {
    const io = new MemoryFaceAuditCliIO({
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
    });

    const exitCode = await runFaceAuditCli(['area-reviewer-instructions', 'wildCards', 'regular.json'], io);

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(io.stdout).toContain('# Face Audit Area Reviewer Instructions: wildCards');
    expect(io.stdout).toContain('- Area: `wildCards`');
    expect(io.stdout).toContain('- Review artifact: `face-audit-area-wildCards-review.json`');
    expect(io.stdout).toContain('- Review sheet: `face-audit-area-wildCards-review-sheet.tsv`');
    expect(io.stdout).toContain('- Todo summary: `face-audit-area-wildCards-todo-summary.json`');
    expect(io.stdout).toContain('- Next step: `review_unreviewed_items`');
    expect(io.stdout).toContain('- Remaining items: 8 / 8');
    expect(io.stdout)
      .toContain('- Summarize this area: `npm run face-audit:todo -- --summary --area wildCards .\\face-audit-area-wildCards-review.json`');
    expect(io.stdout).toMatch(/\n$/);

    const readyIO = new MemoryFaceAuditCliIO({
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
    });
    const readyExitCode = await runFaceAuditCli(['area-reviewer-instructions', 'regularCards', 'regular.json'], readyIO);
    expect(readyExitCode).toBe(0);
    expect(readyIO.stderr).toBe('');
    expect(readyIO.stdout).toContain('# Face Audit Area Reviewer Instructions: regularCards');
    expect(readyIO.stdout).toContain('- Completion status: `ready_to_lock`');
    expect(readyIO.stdout).toContain('- No unfinished items remain for this area.');

    const unknownAreaIO = new MemoryFaceAuditCliIO();
    const unknownAreaExitCode = await runFaceAuditCli(['area-reviewer-instructions', 'badArea'], unknownAreaIO);
    expect(unknownAreaExitCode).toBe(2);
    expect(unknownAreaIO.stdout).toBe('');
    expect(unknownAreaIO.stderr).toContain('Unknown face-audit area: badArea');

    const invalidIO = new MemoryFaceAuditCliIO();
    const invalidExitCode = await runFaceAuditCli(['area-reviewer-instructions', 'wildCards', 'missing.json'], invalidIO);
    expect(invalidExitCode).toBe(2);
    expect(invalidIO.stdout).toBe('');
    expect(invalidIO.stderr).toContain('Could not read a valid review artifact JSON file');
  });

  it('writes CI-friendly status, todo, review plan, review sheet, reviewer instructions, reviewer handoff, and manifest artifacts to an output directory', async () => {
    const files: Record<string, string | Uint8Array> = {
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
      'wild.json': JSON.stringify(filledAreaReviewArtifact('wildCards')),
    };
    const io = new MemoryFaceAuditCliIO(files);

    const exitCode = await runFaceAuditCli(['ci-artifacts', 'out', 'regular.json', 'wild.json'], io);
    const manifest = JSON.parse(io.stdout) as {
      artifactType: string;
      version: number;
      ok: boolean;
      artifactCount: number;
      outputDirectory: string;
      summary: {
        checklistFingerprint: string;
        reviewFingerprint: string;
        checklistItemCount: number;
        reviewedItemCount: number;
        unreviewedItemCount: number;
        pendingAreaCount: number;
        readyAreaCount: number;
        pendingItemCount: number;
        reviewSheetRowCount: number;
        evidenceSourceCount: number;
        areaArtifactCount: number;
        areaTodoSummaryArtifactCount: number;
        areaReviewSheetArtifactCount: number;
        areaReviewerInstructionsArtifactCount: number;
        unfinishedAreas: Array<{
          area: string;
          remainingItemCount: number;
          nextStep: string;
        }>;
      };
      files: Array<{path: string; artifactType: string; ok: boolean; contentHash: string}>;
    };
    const manifestPath = path.join('out', 'face-audit-ci-manifest.json');
    const statusPath = path.join('out', 'face-audit-review-status.json');
    const fullReviewPath = path.join('out', 'face-audit-review.json');
    const todoPath = path.join('out', 'face-audit-review-todo.json');
    const planPath = path.join('out', 'face-audit-review-plan.json');
    const handoffPath = path.join('out', 'face-audit-reviewer-handoff.json');
    const sheetPath = path.join('out', 'face-audit-review-sheet.tsv');
    const instructionsPath = path.join('out', 'face-audit-reviewer-instructions.md');
    const industryAreaPath = path.join('out', 'face-audit-area-industryTiles-review.json');
    const industryAreaTodoSummaryPath = path.join('out', 'face-audit-area-industryTiles-todo-summary.json');
    const industryAreaReviewSheetPath = path.join('out', 'face-audit-area-industryTiles-review-sheet.tsv');
    const industryAreaReviewerInstructionsPath = path.join('out', 'face-audit-area-industryTiles-reviewer-instructions.md');
    const status = JSON.parse(io.textFile(statusPath)) as {
      artifactType: string;
      ok: boolean;
      artifactCount: number;
      checklistFingerprint: string;
      reviewFingerprint: string;
      completion: {reviewedItemCount: number; unreviewedItemCount: number};
    };
    const fullReview = JSON.parse(io.textFile(fullReviewPath)) as ReturnType<typeof buildFaceAuditReviewTemplate>;
    const todo = JSON.parse(io.textFile(todoPath)) as {
      artifactType: string;
      ok: boolean;
      artifactCount: number;
      pendingAreaCount: number;
      readyAreaCount: number;
    };
    const plan = JSON.parse(io.textFile(planPath)) as {
      artifactType: string;
      ok: boolean;
      artifactCount: number;
      pendingAreaCount: number;
      readyAreaCount: number;
      pendingItemCount: number;
      areas: Array<{area: string; items: unknown[]}>;
    };
    const handoff = JSON.parse(io.textFile(handoffPath)) as {
      artifactType: string;
      ok: boolean;
      artifactCount: number;
      reviewFingerprint: string;
      pendingAreaCount: number;
      readyAreaCount: number;
      areas: Array<{area: string; reviewArtifact: {artifactType: string; area: string}}>;
    };
    const reviewSheet = io.textFile(sheetPath);
    const industryAreaReview = JSON.parse(io.textFile(industryAreaPath)) as ReturnType<typeof buildFaceAuditAreaReviewTemplate>;
    const industryAreaTodoSummary = JSON.parse(io.textFile(industryAreaTodoSummaryPath)) as {
      artifactType: string;
      area: string;
      completionStatus: string;
      nextStep: string;
      pendingItemCount: number;
      remainingItemCount: number;
      reviewedItemCount: number;
      unreviewedItemCount: number;
    };
    const industryAreaReviewSheet = io.textFile(industryAreaReviewSheetPath);
    const industryAreaReviewerInstructions = io.textFile(industryAreaReviewerInstructionsPath);
    const instructions = io.textFile(instructionsPath);
    const writtenManifest = JSON.parse(io.textFile(manifestPath)) as typeof manifest;

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(io.directories.has('out')).toBe(true);
    expect(manifest).toEqual({
      artifactType: 'face_audit_ci_artifacts',
      version: 1,
      ok: true,
      artifactCount: 2,
      outputDirectory: 'out',
      summary: {
        checklistFingerprint: status.checklistFingerprint,
        reviewFingerprint: status.reviewFingerprint,
        checklistItemCount: 185,
        reviewedItemCount: 72,
        unreviewedItemCount: 113,
        pendingAreaCount: 4,
        readyAreaCount: 2,
        pendingItemCount: 113,
        reviewSheetRowCount: 185,
        evidenceSourceCount: 1,
        areaArtifactCount: 4,
        areaTodoSummaryArtifactCount: 4,
        areaReviewSheetArtifactCount: 4,
        areaReviewerInstructionsArtifactCount: 4,
        unfinishedAreas: [
          {
            area: 'industryTiles',
            remainingItemCount: 45,
            nextStep: 'review_unreviewed_items',
          },
          {
            area: 'linkLines',
            remainingItemCount: 39,
            nextStep: 'review_unreviewed_items',
          },
          {
            area: 'locationsAndSlots',
            remainingItemCount: 20,
            nextStep: 'review_unreviewed_items',
          },
          {
            area: 'merchantTiles',
            remainingItemCount: 9,
            nextStep: 'review_unreviewed_items',
          },
        ],
      },
      files: [
        ciFileSummary(statusPath, 'face_audit_review_status'),
        ciFileSummary(fullReviewPath, 'face_audit_review'),
        ciFileSummary(todoPath, 'face_audit_review_todo'),
        ciFileSummary(planPath, 'face_audit_review_plan'),
        ciFileSummary(handoffPath, 'face_audit_reviewer_handoff'),
        ciFileSummary(sheetPath, 'face_audit_review_sheet_tsv'),
        ciFileSummary(industryAreaPath, 'face_audit_area_review'),
        ciFileSummary(industryAreaTodoSummaryPath, 'face_audit_area_review_todo_summary'),
        ciFileSummary(industryAreaReviewSheetPath, 'face_audit_area_review_sheet_tsv'),
        ciFileSummary(industryAreaReviewerInstructionsPath, 'face_audit_area_reviewer_instructions'),
        ciFileSummary(path.join('out', 'face-audit-area-linkLines-review.json'), 'face_audit_area_review'),
        ciFileSummary(path.join('out', 'face-audit-area-linkLines-todo-summary.json'), 'face_audit_area_review_todo_summary'),
        ciFileSummary(path.join('out', 'face-audit-area-linkLines-review-sheet.tsv'), 'face_audit_area_review_sheet_tsv'),
        ciFileSummary(path.join('out', 'face-audit-area-linkLines-reviewer-instructions.md'), 'face_audit_area_reviewer_instructions'),
        ciFileSummary(path.join('out', 'face-audit-area-locationsAndSlots-review.json'), 'face_audit_area_review'),
        ciFileSummary(path.join('out', 'face-audit-area-locationsAndSlots-todo-summary.json'), 'face_audit_area_review_todo_summary'),
        ciFileSummary(path.join('out', 'face-audit-area-locationsAndSlots-review-sheet.tsv'), 'face_audit_area_review_sheet_tsv'),
        ciFileSummary(path.join('out', 'face-audit-area-locationsAndSlots-reviewer-instructions.md'), 'face_audit_area_reviewer_instructions'),
        ciFileSummary(path.join('out', 'face-audit-area-merchantTiles-review.json'), 'face_audit_area_review'),
        ciFileSummary(path.join('out', 'face-audit-area-merchantTiles-todo-summary.json'), 'face_audit_area_review_todo_summary'),
        ciFileSummary(path.join('out', 'face-audit-area-merchantTiles-review-sheet.tsv'), 'face_audit_area_review_sheet_tsv'),
        ciFileSummary(path.join('out', 'face-audit-area-merchantTiles-reviewer-instructions.md'), 'face_audit_area_reviewer_instructions'),
        ciFileSummary(instructionsPath, 'face_audit_reviewer_instructions'),
      ],
    });
    expect(writtenManifest).toEqual(manifest);
    expect(fullReview.completion).toMatchObject({
      reviewedItemCount: 72,
      unreviewedItemCount: 113,
    });
    expect(reviewSheet).toBe(buildFaceAuditReviewSheet([fullReview]).tsv);
    expect(reviewSheet.trimEnd().split('\n')).toHaveLength(186);
    expect(reviewSheet.split('\n')[0])
      .toBe('area\titemId\titemKey\tlabel\texpectedFields\treviewStatus\tnextStep\treviewer\treviewedAt\tevidenceRef\tnotes');
    expect(industryAreaReviewSheet).toBe(buildFaceAuditAreaReviewSheet([industryAreaReview], 'industryTiles').tsv);
    expect(industryAreaReviewSheet.trimEnd().split('\n')).toHaveLength(46);
    expect(industryAreaReviewSheet.trimEnd().split('\n').slice(1).every((line) => line.startsWith('industryTiles\t')))
      .toBe(true);
    expect(instructions).toContain('# Face Audit Reviewer Instructions');
    expect(instructions).toContain('- `face-audit-review.json`: merged full review artifact used to rebuild derived exports.');
    expect(instructions).toContain('- `face-audit-review-sheet.tsv`: spreadsheet-friendly assignment and tracking view.');
    expect(instructions)
      .toContain('- `face-audit-area-<area>-review-sheet.tsv`: spreadsheet-friendly tracking view for one unfinished area.');
    expect(instructions)
      .toContain('- `face-audit-area-<area>-todo-summary.json`: counts-only progress for one unfinished area.');
    expect(instructions)
      .toContain('- `face-audit-area-<area>-reviewer-instructions.md`: area-specific reviewer workflow and focus keys.');
    expect(instructions).toContain(`- Checklist fingerprint: \`${status.checklistFingerprint}\``);
    expect(instructions).toContain(`- Review fingerprint: \`${status.reviewFingerprint}\``);
    expect(instructions).toContain('- Progress: 72 / 185 reviewed; 113 unreviewed');
    expect(instructions).toContain('- Areas: 4 pending, 2 ready');
    expect(instructions)
      .toContain('- `industryTiles`: 45 item(s), next step `review_unreviewed_items`, file `face-audit-area-industryTiles-review.json`, sheet `face-audit-area-industryTiles-review-sheet.tsv`, summary `face-audit-area-industryTiles-todo-summary.json`, instructions `face-audit-area-industryTiles-reviewer-instructions.md`');
    expect(instructions)
      .toContain('- Verify this handoff package: `npm run face-audit:verify-handoff -- .\\face-audit-reviewer-handoff.json`');
    expect(industryAreaReviewerInstructions).toContain('# Face Audit Area Reviewer Instructions: industryTiles');
    expect(industryAreaReviewerInstructions).toContain('- Area: `industryTiles`');
    expect(industryAreaReviewerInstructions).toContain(`- Review fingerprint: \`${handoff.reviewFingerprint}\``);
    expect(industryAreaReviewerInstructions).toContain('- Review artifact: `face-audit-area-industryTiles-review.json`');
    expect(industryAreaReviewerInstructions).toContain('- Review sheet: `face-audit-area-industryTiles-review-sheet.tsv`');
    expect(industryAreaReviewerInstructions).toContain('- Todo summary: `face-audit-area-industryTiles-todo-summary.json`');
    expect(industryAreaReviewerInstructions).toContain('- Next step: `review_unreviewed_items`');
    expect(industryAreaReviewerInstructions).toContain('- Remaining items: 45 / 45');
    expect(industryAreaReviewerInstructions)
      .toContain('- Summarize this area: `npm run face-audit:todo -- --summary --area industryTiles .\\face-audit-area-industryTiles-review.json`');
    const verifyIO = new MemoryFaceAuditCliIO(files);
    const verifyExitCode = await runFaceAuditCli(['verify-ci-artifacts', 'out'], verifyIO);
    const verification = JSON.parse(verifyIO.stdout) as {
      artifactType: string;
      version: number;
      ok: boolean;
      outputDirectory: string;
      reviewFingerprint: string;
      pendingAreaCount: number;
      readyAreaCount: number;
      fileCount: number;
      files: Array<{path: string; artifactType: string; ok: boolean; contentHash?: string}>;
      issueCount: number;
      issues: unknown[];
    };
    expect(verifyExitCode).toBe(0);
    expect(verifyIO.stderr).toBe('');
    expect(verification).toMatchObject({
      artifactType: 'face_audit_ci_artifacts_verification',
      version: 1,
      ok: true,
      outputDirectory: 'out',
      reviewFingerprint: handoff.reviewFingerprint,
      pendingAreaCount: 4,
      readyAreaCount: 2,
      issueCount: 0,
      issues: [],
    });
    expect(verification.fileCount).toBe(24);
    expect(verification.files).toContainEqual(ciFileSummary(manifestPath, 'face_audit_ci_artifacts'));
    expect(verification.files).toContainEqual(ciFileSummary(fullReviewPath, 'face_audit_review'));
    expect(verification.files).toContainEqual(ciFileSummary(sheetPath, 'face_audit_review_sheet_tsv'));
    expect(verification.files).toContainEqual(ciFileSummary(instructionsPath, 'face_audit_reviewer_instructions'));
    expect(verification.files).toContainEqual(ciFileSummary(industryAreaPath, 'face_audit_area_review'));
    expect(verification.files).toContainEqual(ciFileSummary(industryAreaTodoSummaryPath, 'face_audit_area_review_todo_summary'));
    expect(verification.files).toContainEqual(ciFileSummary(industryAreaReviewSheetPath, 'face_audit_area_review_sheet_tsv'));
    expect(verification.files)
      .toContainEqual(ciFileSummary(industryAreaReviewerInstructionsPath, 'face_audit_area_reviewer_instructions'));

    const tamperedIO = new MemoryFaceAuditCliIO({
      ...files,
      [industryAreaPath]: JSON.stringify({
        ...industryAreaReview,
        area: 'wildCards',
      }),
    });
    const tamperedExitCode = await runFaceAuditCli(['verify-ci-artifacts', 'out'], tamperedIO);
    const tamperedVerification = JSON.parse(tamperedIO.stdout) as {
      ok: boolean;
      issueCount: number;
      issues: Array<{field: string; message: string}>;
    };
    expect(tamperedExitCode).toBe(1);
    expect(tamperedVerification.ok).toBe(false);
    expect(tamperedVerification.issueCount).toBeGreaterThan(0);
    expect(tamperedVerification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'face-audit-area-industryTiles-review.json',
        message: 'CI area artifact file face-audit-area-industryTiles-review.json does not match the reviewer handoff embedded area artifact',
      }),
    ]));

    const tamperedAreaTodoSummaryIO = new MemoryFaceAuditCliIO({
      ...files,
      [industryAreaTodoSummaryPath]: JSON.stringify({
        ...industryAreaTodoSummary,
        remainingItemCount: 999,
      }),
      [manifestPath]: JSON.stringify({
        ...manifest,
        summary: {
          ...manifest.summary,
          unfinishedAreas: manifest.summary.unfinishedAreas.map((area) => area.area === 'industryTiles'
            ? {...area, remainingItemCount: 999}
            : area),
        },
      }),
    });
    const tamperedAreaTodoSummaryExitCode = await runFaceAuditCli(['verify-ci-artifacts', 'out'], tamperedAreaTodoSummaryIO);
    const tamperedAreaTodoSummaryVerification = JSON.parse(tamperedAreaTodoSummaryIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };
    expect(tamperedAreaTodoSummaryExitCode).toBe(1);
    expect(tamperedAreaTodoSummaryVerification.ok).toBe(false);
    expect(tamperedAreaTodoSummaryVerification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'face-audit-area-industryTiles-todo-summary.json',
        message: 'CI area todo summary artifact file face-audit-area-industryTiles-todo-summary.json does not match the reviewer handoff embedded todo area',
      }),
    ]));

    const tamperedAreaReviewerInstructionsIO = new MemoryFaceAuditCliIO({
      ...files,
      [industryAreaReviewerInstructionsPath]: `${industryAreaReviewerInstructions}Extra note.\n`,
    });
    const tamperedAreaReviewerInstructionsExitCode =
      await runFaceAuditCli(['verify-ci-artifacts', 'out'], tamperedAreaReviewerInstructionsIO);
    const tamperedAreaReviewerInstructionsVerification = JSON.parse(tamperedAreaReviewerInstructionsIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };
    expect(tamperedAreaReviewerInstructionsExitCode).toBe(1);
    expect(tamperedAreaReviewerInstructionsVerification.ok).toBe(false);
    expect(tamperedAreaReviewerInstructionsVerification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'face-audit-area-industryTiles-reviewer-instructions.md',
        message: 'CI area reviewer instructions file face-audit-area-industryTiles-reviewer-instructions.md does not match the reviewer handoff embedded todo area',
      }),
    ]));

    const tamperedAreaReviewSheetIO = new MemoryFaceAuditCliIO({
      ...files,
      [industryAreaReviewSheetPath]: industryAreaReviewSheet.replace('industryTiles', 'tamperedArea'),
    });
    const tamperedAreaReviewSheetExitCode =
      await runFaceAuditCli(['verify-ci-artifacts', 'out'], tamperedAreaReviewSheetIO);
    const tamperedAreaReviewSheetVerification = JSON.parse(tamperedAreaReviewSheetIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };
    expect(tamperedAreaReviewSheetExitCode).toBe(1);
    expect(tamperedAreaReviewSheetVerification.ok).toBe(false);
    expect(tamperedAreaReviewSheetVerification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'face-audit-area-industryTiles-review-sheet.tsv',
        message: 'CI area review sheet artifact file face-audit-area-industryTiles-review-sheet.tsv does not match face-audit-area-industryTiles-review.json',
      }),
      expect.objectContaining({
        field: 'face-audit-ci-manifest.json',
        message: 'CI manifest file face-audit-ci-manifest.json does not match the artifacts in the directory',
      }),
    ]));

    const tamperedManifestIO = new MemoryFaceAuditCliIO({
      ...files,
      [manifestPath]: JSON.stringify({
        ...manifest,
        summary: {
          ...manifest.summary,
          pendingAreaCount: 99,
        },
      }),
    });
    const tamperedManifestExitCode = await runFaceAuditCli(['verify-ci-artifacts', 'out'], tamperedManifestIO);
    const tamperedManifestVerification = JSON.parse(tamperedManifestIO.stdout) as {
      ok: boolean;
      issueCount: number;
      issues: Array<{field: string; message: string}>;
    };
    expect(tamperedManifestExitCode).toBe(1);
    expect(tamperedManifestVerification.ok).toBe(false);
    expect(tamperedManifestVerification.issueCount).toBeGreaterThan(0);
    expect(tamperedManifestVerification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'face-audit-ci-manifest.json',
        message: 'CI manifest file face-audit-ci-manifest.json does not match the artifacts in the directory',
      }),
    ]));

    const tamperedInstructionIO = new MemoryFaceAuditCliIO({
      ...files,
      [instructionsPath]: `${instructions}Tampered reviewer note.\n`,
    });
    const tamperedInstructionExitCode = await runFaceAuditCli(['verify-ci-artifacts', 'out'], tamperedInstructionIO);
    const tamperedInstructionVerification = JSON.parse(tamperedInstructionIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };
    expect(tamperedInstructionExitCode).toBe(1);
    expect(tamperedInstructionVerification.ok).toBe(false);
    expect(tamperedInstructionVerification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'face-audit-ci-manifest.json',
        message: 'CI manifest file face-audit-ci-manifest.json does not match the artifacts in the directory',
      }),
    ]));

    const tamperedSheetIO = new MemoryFaceAuditCliIO({
      ...files,
      [sheetPath]: reviewSheet.replace('regularCards', 'tamperedArea'),
    });
    const tamperedSheetExitCode = await runFaceAuditCli(['verify-ci-artifacts', 'out'], tamperedSheetIO);
    const tamperedSheetVerification = JSON.parse(tamperedSheetIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };
    expect(tamperedSheetExitCode).toBe(1);
    expect(tamperedSheetVerification.ok).toBe(false);
    expect(tamperedSheetVerification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'face-audit-review-sheet.tsv',
        message: 'CI review sheet artifact file face-audit-review-sheet.tsv does not match face-audit-review.json',
      }),
      expect.objectContaining({
        field: 'face-audit-ci-manifest.json',
        message: 'CI manifest file face-audit-ci-manifest.json does not match the artifacts in the directory',
      }),
    ]));

    const tamperedSheet = reviewSheet.replace('regularCards', 'tamperedArea');
    const manifestWithTamperedSheet = {
      ...manifest,
      ok: false,
      files: manifest.files.map((file) => file.path === sheetPath
        ? {
            ...file,
            ok: false,
            contentHash: sha256TextContentHash(tamperedSheet),
          }
        : file),
    };
    const tamperedSheetUpdatedManifestIO = new MemoryFaceAuditCliIO({
      ...files,
      [sheetPath]: tamperedSheet,
      [manifestPath]: JSON.stringify(manifestWithTamperedSheet),
    });
    const tamperedSheetUpdatedManifestExitCode = await runFaceAuditCli(['verify-ci-artifacts', 'out'], tamperedSheetUpdatedManifestIO);
    const tamperedSheetUpdatedManifestVerification = JSON.parse(tamperedSheetUpdatedManifestIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };
    expect(tamperedSheetUpdatedManifestExitCode).toBe(1);
    expect(tamperedSheetUpdatedManifestVerification.ok).toBe(false);
    expect(tamperedSheetUpdatedManifestVerification.issues).toContainEqual({
      field: 'face-audit-review-sheet.tsv',
      message: 'CI review sheet artifact file face-audit-review-sheet.tsv does not match face-audit-review.json',
    });
    expect(tamperedSheetUpdatedManifestVerification.issues)
      .not.toContainEqual(expect.objectContaining({field: 'face-audit-ci-manifest.json'}));

    const tamperedStatusIO = new MemoryFaceAuditCliIO({
      ...files,
      [statusPath]: JSON.stringify({
        ...status,
        completion: {
          ...status.completion,
          reviewedItemCount: 99,
        },
      }),
      [manifestPath]: JSON.stringify({
        ...manifest,
        summary: {
          ...manifest.summary,
          reviewedItemCount: 99,
        },
      }),
    });
    const tamperedStatusExitCode = await runFaceAuditCli(['verify-ci-artifacts', 'out'], tamperedStatusIO);
    const tamperedStatusVerification = JSON.parse(tamperedStatusIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };
    expect(tamperedStatusExitCode).toBe(1);
    expect(tamperedStatusVerification.ok).toBe(false);
    expect(tamperedStatusVerification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'face-audit-review-status.json',
        message: 'CI status artifact file face-audit-review-status.json summary does not match the reviewer handoff',
      }),
    ]));

    const tamperedTodoIO = new MemoryFaceAuditCliIO({
      ...files,
      [todoPath]: JSON.stringify({
        ...todo,
        pendingAreaCount: 99,
      }),
      [manifestPath]: JSON.stringify({
        ...manifest,
        summary: {
          ...manifest.summary,
          pendingAreaCount: 99,
        },
      }),
    });
    const tamperedTodoExitCode = await runFaceAuditCli(['verify-ci-artifacts', 'out'], tamperedTodoIO);
    const tamperedTodoVerification = JSON.parse(tamperedTodoIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };
    expect(tamperedTodoExitCode).toBe(1);
    expect(tamperedTodoVerification.ok).toBe(false);
    expect(tamperedTodoVerification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'face-audit-review-todo.json',
        message: 'CI todo artifact file face-audit-review-todo.json does not match the reviewer handoff embedded todo',
      }),
    ]));

    const tamperedPlanIO = new MemoryFaceAuditCliIO({
      ...files,
      [planPath]: JSON.stringify({
        ...plan,
        pendingItemCount: 999,
      }),
      [manifestPath]: JSON.stringify({
        ...manifest,
        summary: {
          ...manifest.summary,
          pendingItemCount: 999,
        },
      }),
    });
    const tamperedPlanExitCode = await runFaceAuditCli(['verify-ci-artifacts', 'out'], tamperedPlanIO);
    const tamperedPlanVerification = JSON.parse(tamperedPlanIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };
    expect(tamperedPlanExitCode).toBe(1);
    expect(tamperedPlanVerification.ok).toBe(false);
    expect(tamperedPlanVerification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'face-audit-review-plan.json',
        message: 'CI review-plan artifact file face-audit-review-plan.json does not match the reviewer handoff embedded area artifacts',
      }),
    ]));
    expect(status).toMatchObject({
      artifactType: 'face_audit_review_status',
      ok: true,
      artifactCount: 2,
      completion: {
        reviewedItemCount: 72,
        unreviewedItemCount: 113,
      },
    });
    expect(todo).toMatchObject({
      artifactType: 'face_audit_review_todo',
      ok: true,
      artifactCount: 2,
      pendingAreaCount: 4,
      readyAreaCount: 2,
    });
    expect(plan).toMatchObject({
      artifactType: 'face_audit_review_plan',
      ok: true,
      artifactCount: 2,
      pendingAreaCount: 4,
      readyAreaCount: 2,
      pendingItemCount: 113,
    });
    expect(plan.areas.find((area) => area.area === 'industryTiles')?.items).toHaveLength(45);
    expect(handoff).toMatchObject({
      artifactType: 'face_audit_reviewer_handoff',
      ok: true,
      artifactCount: 2,
      pendingAreaCount: 4,
      readyAreaCount: 2,
    });
    expect(handoff.areas.map((area) => area.area)).not.toContain('regularCards');
    expect(handoff.areas.map((area) => area.area)).not.toContain('wildCards');
    expect(handoff.areas.find((area) => area.area === 'industryTiles')?.reviewArtifact)
      .toMatchObject({artifactType: 'face_audit_area_review', area: 'industryTiles'});
    expect(industryAreaReview).toMatchObject({
      artifactType: 'face_audit_area_review',
      area: 'industryTiles',
      areaItemCount: 45,
      completion: {
        status: 'not_started',
        unreviewedItemCount: 45,
      },
    });
    expect(industryAreaTodoSummary).toMatchObject({
      artifactType: 'face_audit_area_review_todo_summary',
      area: 'industryTiles',
      completionStatus: 'not_started',
      nextStep: 'review_unreviewed_items',
      pendingItemCount: 45,
      remainingItemCount: 45,
      reviewedItemCount: 0,
      unreviewedItemCount: 45,
    });

    const missingOutputIO = new MemoryFaceAuditCliIO();
    const missingOutputExitCode = await runFaceAuditCli(['ci-artifacts'], missingOutputIO);
    expect(missingOutputExitCode).toBe(2);
    expect(missingOutputIO.stdout).toBe('');
    expect(missingOutputIO.stderr)
      .toContain('The ci-artifacts command expects an output directory and optional review artifact JSON files.');

    const malformedArtifactIO = new MemoryFaceAuditCliIO({'bad.json': '{not-json'});
    const malformedArtifactExitCode = await runFaceAuditCli(['ci-artifacts', 'out', 'bad.json'], malformedArtifactIO);
    expect(malformedArtifactExitCode).toBe(2);
    expect(malformedArtifactIO.stdout).toBe('');
    expect(malformedArtifactIO.stderr).toContain('Could not read a valid review artifact JSON file');
    expect(malformedArtifactIO.directories.has('out')).toBe(false);

    const missingVerifyDirectoryIO = new MemoryFaceAuditCliIO();
    expect(await runFaceAuditCli(['verify-ci-artifacts'], missingVerifyDirectoryIO)).toBe(2);
    expect(missingVerifyDirectoryIO.stderr)
      .toContain('The verify-ci-artifacts command expects exactly one output directory.');
  });

  it('self-checks generated CI artifacts in a temporary directory and cleans it up', async () => {
    const io = new MemoryFaceAuditCliIO({
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
      'wild.json': JSON.stringify(filledAreaReviewArtifact('wildCards')),
    });

    const exitCode = await runFaceAuditCli(['ci-artifacts-self-check', 'regular.json', 'wild.json'], io);
    const report = JSON.parse(io.stdout) as {
      artifactType: string;
      version: number;
      ok: boolean;
      artifactCount: number;
      outputDirectory: string;
      cleanedUp: boolean;
      reviewFingerprint: string;
      pendingAreaCount: number;
      readyAreaCount: number;
      fileCount: number;
      issueCount: number;
      issues: unknown[];
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(report).toMatchObject({
      artifactType: 'face_audit_ci_artifacts_self_check',
      version: 1,
      ok: true,
      artifactCount: 2,
      outputDirectory: path.join('tmp', 'face-audit-ci-artifacts-1'),
      cleanedUp: true,
      pendingAreaCount: 4,
      readyAreaCount: 2,
      fileCount: 24,
      issueCount: 0,
      issues: [],
    });
    expect(report.reviewFingerprint).toEqual(expect.any(String));
    expect(io.removedDirectories.has(report.outputDirectory)).toBe(true);
    expect(io.directories.has(report.outputDirectory)).toBe(false);
    expect(() => io.textFile(path.join(report.outputDirectory, 'face-audit-ci-manifest.json')))
      .toThrow(`Missing text file ${path.join(report.outputDirectory, 'face-audit-ci-manifest.json')}`);

    const invalidIO = new MemoryFaceAuditCliIO({'bad.json': '{not-json'});
    const invalidExitCode = await runFaceAuditCli(['ci-artifacts-self-check', 'bad.json'], invalidIO);
    expect(invalidExitCode).toBe(2);
    expect(invalidIO.stdout).toBe('');
    expect(invalidIO.stderr).toContain('Could not read a valid review artifact JSON file');
    expect(invalidIO.removedDirectories.size).toBe(0);
  });

  it('prints reviewer handoff artifacts with unfinished area review templates', async () => {
    const io = new MemoryFaceAuditCliIO({
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
      'wild.json': JSON.stringify(filledAreaReviewArtifact('wildCards')),
    });

    const exitCode = await runFaceAuditCli(['handoff', 'regular.json', 'wild.json'], io);
    const handoff = JSON.parse(io.stdout) as {
      artifactType: string;
      version: number;
      ok: boolean;
      artifactCount: number;
      checklistFingerprint: string;
      reviewFingerprint: string;
      checklistItemCount: number;
      evidenceSourceCount: number;
      pendingAreaCount: number;
      readyAreaCount: number;
      todo: {
        artifactType: string;
        pendingAreaCount: number;
      };
      areas: Array<{
        area: string;
        todo: {
          area: string;
          remainingItemCount: number;
        };
        reviewArtifact: {
          artifactType: string;
          area: string;
          areaItemCount: number;
          evidenceSources: unknown[];
          completion: {
            status: string;
            unreviewedItemCount: number;
          };
          items: Array<{reviewStatus: string}>;
        };
      }>;
      issueCount: number;
      issues: unknown[];
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(handoff.artifactType).toBe('face_audit_reviewer_handoff');
    expect(handoff.version).toBe(1);
    expect(handoff.ok).toBe(true);
    expect(handoff.artifactCount).toBe(2);
    expect(handoff.checklistFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(handoff.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(handoff.checklistItemCount).toBe(185);
    expect(handoff.evidenceSourceCount).toBe(1);
    expect(handoff.pendingAreaCount).toBe(4);
    expect(handoff.readyAreaCount).toBe(2);
    expect(handoff.todo).toMatchObject({
      artifactType: 'face_audit_review_todo',
      pendingAreaCount: 4,
    });
    expect(handoff.areas.map((area) => area.area)).not.toContain('regularCards');
    expect(handoff.areas.map((area) => area.area)).not.toContain('wildCards');
    expect(handoff.areas.find((area) => area.area === 'industryTiles')).toMatchObject({
      todo: {
        area: 'industryTiles',
        remainingItemCount: 45,
      },
      reviewArtifact: {
        artifactType: 'face_audit_area_review',
        area: 'industryTiles',
        areaItemCount: 45,
        completion: {
          status: 'not_started',
          unreviewedItemCount: 45,
        },
      },
    });
    expect(handoff.areas.find((area) => area.area === 'industryTiles')?.reviewArtifact.evidenceSources)
      .toHaveLength(1);
    expect(handoff.areas.find((area) => area.area === 'industryTiles')?.reviewArtifact.items
      .every((item) => item.reviewStatus === 'unreviewed')).toBe(true);
    expect(handoff.issueCount).toBe(0);
    expect(handoff.issues).toEqual([]);
  });

  it('verifies reviewer handoff artifacts against the current checklist', async () => {
    const handoff = buildFaceAuditReviewerHandoff([
      filledAreaReviewArtifact('regularCards'),
      filledAreaReviewArtifact('wildCards'),
    ]);
    const io = new MemoryFaceAuditCliIO({
      'handoff.json': JSON.stringify(handoff),
    });

    const exitCode = await runFaceAuditCli(['verify-handoff', 'handoff.json'], io);
    const validation = JSON.parse(io.stdout) as {
      ok: boolean;
      handoff?: {reviewFingerprint: string; pendingAreaCount: number};
      issues: unknown[];
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(validation.ok).toBe(true);
    expect(validation.handoff).toMatchObject({
      reviewFingerprint: handoff.reviewFingerprint,
      pendingAreaCount: handoff.pendingAreaCount,
    });
    expect(validation.issues).toEqual([]);

    const staleIO = new MemoryFaceAuditCliIO({
      'handoff.json': JSON.stringify({
        ...handoff,
        checklistFingerprint: 'fnv1a32:00000000',
      }),
    });
    const staleExitCode = await runFaceAuditCli(['verify-handoff', 'handoff.json'], staleIO);
    const staleValidation = JSON.parse(staleIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };

    expect(staleExitCode).toBe(1);
    expect(staleIO.stderr).toBe('');
    expect(staleValidation.ok).toBe(false);
    expect(staleValidation.issues).toContainEqual({
      field: 'checklistFingerprint',
      message: 'Face-audit reviewer handoff does not match the current checklist',
    });

    const extraArgIO = new MemoryFaceAuditCliIO({
      'handoff.json': JSON.stringify(handoff),
    });
    expect(await runFaceAuditCli(['verify-handoff', 'handoff.json', 'extra.json'], extraArgIO)).toBe(2);
    expect(extraArgIO.stderr).toContain('The verify-handoff command expects exactly one handoff artifact JSON file.');
  });

  it('summarizes reviewer handoff response artifacts', async () => {
    const handoff = buildFaceAuditReviewerHandoff([
      filledAreaReviewArtifact('regularCards'),
    ]);
    const industryResponse = filledAreaReviewArtifact('industryTiles');
    const io = new MemoryFaceAuditCliIO({
      'handoff.json': JSON.stringify(handoff),
      'industry.json': JSON.stringify(industryResponse),
    });

    const exitCode = await runFaceAuditCli(['handoff-response', 'handoff.json', 'industry.json'], io);
    const report = JSON.parse(io.stdout) as {
      artifactType: string;
      ok: boolean;
      handoffReviewFingerprint: string;
      handoffPendingAreaCount: number;
      responseArtifactCount: number;
      acceptedAreaCount: number;
      readyAreaCount: number;
      missingAreaCount: number;
      remainingAreaCount: number;
      areas: Array<{area: string; completionStatus: string; remainingItemCount: number}>;
      issueCount: number;
      issues: unknown[];
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(report).toMatchObject({
      artifactType: 'face_audit_reviewer_handoff_response',
      ok: true,
      handoffReviewFingerprint: handoff.reviewFingerprint,
      handoffPendingAreaCount: 5,
      responseArtifactCount: 1,
      acceptedAreaCount: 1,
      readyAreaCount: 1,
      missingAreaCount: 4,
      remainingAreaCount: 4,
      issueCount: 0,
      issues: [],
    });
    expect(report.areas).toEqual([expect.objectContaining({
      area: 'industryTiles',
      completionStatus: 'ready_to_lock',
      remainingItemCount: 0,
    })]);

    const nonPendingIO = new MemoryFaceAuditCliIO({
      'handoff.json': JSON.stringify(handoff),
      'regular.json': JSON.stringify(filledAreaReviewArtifact('regularCards')),
    });
    const nonPendingExitCode = await runFaceAuditCli(['handoff-response', 'handoff.json', 'regular.json'], nonPendingIO);
    const nonPendingReport = JSON.parse(nonPendingIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };

    expect(nonPendingExitCode).toBe(1);
    expect(nonPendingIO.stderr).toBe('');
    expect(nonPendingReport.ok).toBe(false);
    expect(nonPendingReport.issues).toContainEqual({
      field: 'artifacts[0].area',
      message: 'Face-audit handoff response area is not part of the reviewer handoff pending areas',
    });

    const missingArgIO = new MemoryFaceAuditCliIO();
    expect(await runFaceAuditCli(['handoff-response'], missingArgIO)).toBe(2);
    expect(missingArgIO.stderr)
      .toContain('The handoff-response command expects a handoff artifact JSON file and optional area review artifact files.');
  });

  it('validates a filled review artifact with a zero exit code', async () => {
    const io = new MemoryFaceAuditCliIO({
      'review.json': JSON.stringify(filledReviewArtifact()),
    });

    const exitCode = await runFaceAuditCli(['validate', 'review.json'], io);
    const validation = JSON.parse(io.stdout) as {
      ok: boolean;
      review: ReturnType<typeof buildFaceAuditReviewTemplate>;
      issues: unknown[];
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.review.completion.status).toBe('ready_to_lock');
  });

  it('enforces the stricter ready gate for release checks', async () => {
    const template = buildFaceAuditReviewTemplate();
    const unreviewedIO = new MemoryFaceAuditCliIO({
      'review.json': JSON.stringify(template),
    });

    const unreviewedExitCode = await runFaceAuditCli(['ready', 'review.json'], unreviewedIO);
    const unreviewedValidation = JSON.parse(unreviewedIO.stdout) as {
      ok: boolean;
      review: ReturnType<typeof buildFaceAuditReviewTemplate>;
      issues: Array<{field: string; message: string}>;
    };

    expect(unreviewedExitCode).toBe(1);
    expect(unreviewedIO.stderr).toBe('');
    expect(unreviewedValidation.ok).toBe(false);
    expect(unreviewedValidation.review.completion.status).toBe('not_started');
    expect(unreviewedValidation.issues).toEqual(expect.arrayContaining([
      {
        field: 'completion.status',
        message: 'Face-audit review must be ready_to_lock before audit statuses can be locked',
      },
      {
        field: 'completion.unreviewedItemCount',
        message: 'Face-audit review still has 185 unreviewed item(s)',
      },
    ]));

    const readyIO = new MemoryFaceAuditCliIO({
      'review.json': JSON.stringify(filledReviewArtifact()),
    });
    const readyExitCode = await runFaceAuditCli(['ready', 'review.json'], readyIO);
    const readyValidation = JSON.parse(readyIO.stdout) as {
      ok: boolean;
      review: ReturnType<typeof buildFaceAuditReviewTemplate>;
      issues: unknown[];
    };

    expect(readyExitCode).toBe(0);
    expect(readyIO.stderr).toBe('');
    expect(readyValidation.ok).toBe(true);
    expect(readyValidation.issues).toEqual([]);
    expect(readyValidation.review.completion.status).toBe('ready_to_lock');
  });

  it('prints an audit-status lock preview after the ready gate passes', async () => {
    const unreadyIO = new MemoryFaceAuditCliIO({
      'review.json': JSON.stringify(buildFaceAuditReviewTemplate()),
    });
    const unreadyExitCode = await runFaceAuditCli(['lock-preview', 'review.json'], unreadyIO);
    const unreadyPreview = JSON.parse(unreadyIO.stdout) as {
      ok: boolean;
      lockPreview?: unknown;
      issues: Array<{field: string; message: string}>;
    };

    expect(unreadyExitCode).toBe(1);
    expect(unreadyIO.stderr).toBe('');
    expect(unreadyPreview.ok).toBe(false);
    expect(unreadyPreview.lockPreview).toBeUndefined();
    expect(unreadyPreview.issues).toEqual(expect.arrayContaining([{
      field: 'completion.status',
      message: 'Face-audit review must be ready_to_lock before audit statuses can be locked',
    }]));

    const readyIO = new MemoryFaceAuditCliIO({
      'review.json': JSON.stringify(filledReviewArtifact()),
    });
    const readyExitCode = await runFaceAuditCli(['lock-preview', 'review.json'], readyIO);
    const readyPreview = JSON.parse(readyIO.stdout) as {
      ok: boolean;
      lockPreview: {
        version: number;
        reviewFingerprint: string;
        checklistItemCount: number;
        areas: Array<{
          area: string;
          currentStatus: string;
          nextStatus: string;
          reviewedItemCount: number;
          reviewers: string[];
          evidenceRefs: string[];
          evidenceRefCount: number;
          areaLevelEvidenceRefCount: number;
          itemSpecificEvidenceRefCount: number;
          itemSpecificEvidenceItemCount: number;
        }>;
      };
    };

    expect(readyExitCode).toBe(0);
    expect(readyIO.stderr).toBe('');
    expect(readyPreview.ok).toBe(true);
    expect(readyPreview.lockPreview.version).toBe(1);
    expect(readyPreview.lockPreview.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(readyPreview.lockPreview.checklistItemCount).toBe(185);
    expect(readyPreview.lockPreview.areas).toContainEqual(expect.objectContaining({
      area: 'regularCards',
      currentStatus: 'manifest_locked_face_audit_pending',
      nextStatus: 'manifest_locked',
      reviewedItemCount: 64,
      reviewers: ['Ada'],
      evidenceRefs: ['official-component:photo-set#regularCards'],
      evidenceRefCount: 1,
      areaLevelEvidenceRefCount: 1,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
    }));
  });

  it('prints a compact lock-evidence artifact after the ready gate passes', async () => {
    const unreadyIO = new MemoryFaceAuditCliIO({
      'review.json': JSON.stringify(buildFaceAuditReviewTemplate()),
    });
    const unreadyExitCode = await runFaceAuditCli(['lock-artifact', 'review.json'], unreadyIO);
    const unreadyResult = JSON.parse(unreadyIO.stdout) as {
      ok: boolean;
      lockArtifact?: unknown;
      issues: Array<{field: string; message: string}>;
    };

    expect(unreadyExitCode).toBe(1);
    expect(unreadyIO.stderr).toBe('');
    expect(unreadyResult.ok).toBe(false);
    expect(unreadyResult.lockArtifact).toBeUndefined();
    expect(unreadyResult.issues).toEqual(expect.arrayContaining([{
      field: 'completion.status',
      message: 'Face-audit review must be ready_to_lock before audit statuses can be locked',
    }]));

    const readyIO = new MemoryFaceAuditCliIO({
      'review.json': JSON.stringify(filledReviewArtifact()),
    });
    const readyExitCode = await runFaceAuditCli(['lock-artifact', 'review.json'], readyIO);
    const lockArtifact = JSON.parse(readyIO.stdout) as {
      artifactType: string;
      version: number;
      checklistItemCount: number;
      reviewFingerprint: string;
      areas: Array<{
        area: string;
        currentStatus: string;
        nextStatus: string;
        reviewedItemCount: number;
        reviewers: string[];
        evidenceRefs: string[];
        evidenceRefCount: number;
        areaLevelEvidenceRefCount: number;
        itemSpecificEvidenceRefCount: number;
        itemSpecificEvidenceItemCount: number;
      }>;
      completion: {
        status: string;
        reviewedItemCount: number;
      };
      items?: unknown;
      review?: unknown;
      issues?: unknown;
    };

    expect(readyExitCode).toBe(0);
    expect(readyIO.stderr).toBe('');
    expect(lockArtifact.artifactType).toBe('face_audit_lock_evidence');
    expect(lockArtifact.version).toBe(1);
    expect(lockArtifact.checklistItemCount).toBe(185);
    expect(lockArtifact.reviewFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(lockArtifact.completion).toMatchObject({
      status: 'ready_to_lock',
      reviewedItemCount: 185,
    });
    expect(lockArtifact.areas).toContainEqual(expect.objectContaining({
      area: 'regularCards',
      currentStatus: 'manifest_locked_face_audit_pending',
      nextStatus: 'manifest_locked',
      reviewedItemCount: 64,
      reviewers: ['Ada'],
      evidenceRefs: ['official-component:photo-set#regularCards'],
      evidenceRefCount: 1,
      areaLevelEvidenceRefCount: 1,
      itemSpecificEvidenceRefCount: 0,
      itemSpecificEvidenceItemCount: 0,
    }));
    expect(lockArtifact.items).toBeUndefined();
    expect(lockArtifact.review).toBeUndefined();
    expect(lockArtifact.issues).toBeUndefined();
  });

  it('verifies compact lock-evidence artifacts against the current checklist', async () => {
    const lockArtifact = buildFaceAuditLockArtifact(filledReviewArtifact()).lockArtifact;
    if (!lockArtifact) {
      throw new Error('Expected filled review artifact to build lock evidence');
    }
    const validIO = new MemoryFaceAuditCliIO({
      'lock.json': JSON.stringify(lockArtifact),
    });

    const validExitCode = await runFaceAuditCli(['verify-lock-artifact', 'lock.json'], validIO);
    const validResult = JSON.parse(validIO.stdout) as {
      ok: boolean;
      lockArtifact: {
        artifactType: string;
        checklistItemCount: number;
        completion: {
          status: string;
        };
      };
      issues: unknown[];
    };

    expect(validExitCode).toBe(0);
    expect(validIO.stderr).toBe('');
    expect(validResult.ok).toBe(true);
    expect(validResult.issues).toEqual([]);
    expect(validResult.lockArtifact).toMatchObject({
      artifactType: 'face_audit_lock_evidence',
      checklistItemCount: 185,
      completion: {
        status: 'ready_to_lock',
      },
    });

    const invalidIO = new MemoryFaceAuditCliIO({
      'lock.json': JSON.stringify({
        ...lockArtifact,
        checklistFingerprint: 'fnv1a32:00000000',
        areas: lockArtifact.areas.map((area, index) => index === 0
          ? {...area, evidenceRefs: []}
          : area),
      }),
    });

    const invalidExitCode = await runFaceAuditCli(['verify-lock-artifact', 'lock.json'], invalidIO);
    const invalidResult = JSON.parse(invalidIO.stdout) as {
      ok: boolean;
      lockArtifact?: unknown;
      issues: Array<{field: string; message: string}>;
    };

    expect(invalidExitCode).toBe(1);
    expect(invalidIO.stderr).toBe('');
    expect(invalidResult.ok).toBe(false);
    expect(invalidResult.lockArtifact).toBeUndefined();
    expect(invalidResult.issues).toEqual(expect.arrayContaining([
      {
        field: 'areas[0].evidenceRefs',
        message: 'Face-audit lock artifact area must include at least one official evidence reference',
      },
      {
        field: 'checklistFingerprint',
        message: 'Face-audit lock artifact does not match the current or lock-transition checklist fingerprint',
      },
    ]));
  });

  it('runs the release gate for current static audit status and optional lock evidence', async () => {
    const currentIO = new MemoryFaceAuditCliIO();

    const currentExitCode = await runFaceAuditCli(['release-gate'], currentIO);
    const currentResult = JSON.parse(currentIO.stdout) as {
      ok: boolean;
      pendingAreaCount: number;
      lockedAreaCount: number;
      issues: unknown[];
    };

    expect(currentExitCode).toBe(0);
    expect(currentIO.stderr).toBe('');
    expect(currentResult).toEqual({
      ok: true,
      pendingAreaCount: 6,
      lockedAreaCount: 0,
      issues: [],
    });

    const invalidIO = new MemoryFaceAuditCliIO({
      'lock.json': JSON.stringify({artifactType: 'face_audit_lock_evidence'}),
    });

    const invalidExitCode = await runFaceAuditCli(['release-gate', 'lock.json'], invalidIO);
    const invalidResult = JSON.parse(invalidIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };

    expect(invalidExitCode).toBe(1);
    expect(invalidIO.stderr).toBe('');
    expect(invalidResult.ok).toBe(false);
    expect(invalidResult.issues).toEqual(expect.arrayContaining([
      {field: 'version', message: 'Face-audit lock artifact must be version 1'},
      {
        field: 'checklistItemCount',
        message: 'Face-audit lock artifact item count does not match the current checklist',
      },
    ]));

    const lockArtifact = buildFaceAuditLockArtifact(filledReviewArtifact()).lockArtifact;
    if (!lockArtifact) {
      throw new Error('Expected filled review artifact to build lock evidence');
    }
    const validIO = new MemoryFaceAuditCliIO({
      'lock.json': JSON.stringify(lockArtifact),
    });

    const validExitCode = await runFaceAuditCli(['release-gate', 'lock.json'], validIO);
    const validResult = JSON.parse(validIO.stdout) as {
      ok: boolean;
      pendingAreaCount: number;
      lockedAreaCount: number;
      lockArtifactValidation?: {ok: boolean};
      issues: unknown[];
    };

    expect(validExitCode).toBe(0);
    expect(validIO.stderr).toBe('');
    expect(validResult.ok).toBe(true);
    expect(validResult.pendingAreaCount).toBe(6);
    expect(validResult.lockedAreaCount).toBe(0);
    expect(validResult.lockArtifactValidation?.ok).toBe(true);
    expect(validResult.issues).toEqual([]);
  });

  it('returns a non-zero exit code for valid JSON with review issues', async () => {
    const artifact = {
      ...filledReviewArtifact(),
      checklistFingerprint: 'fnv1a32:00000000',
    };
    const io = new MemoryFaceAuditCliIO({
      'review.json': JSON.stringify(artifact),
    });

    const exitCode = await runFaceAuditCli(['validate', 'review.json'], io);
    const validation = JSON.parse(io.stdout) as {
      ok: boolean;
      issues: Array<{field: string; message: string}>;
    };

    expect(exitCode).toBe(1);
    expect(io.stderr).toBe('');
    expect(validation.ok).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      {field: 'checklistFingerprint', message: 'Face-audit review artifact does not match the current checklist'},
    ]));
  });

  it('prints sha256 content hashes for local evidence source files', async () => {
    const io = new MemoryFaceAuditCliIO({
      'reviewer-photos/regular-cards.zip': 'regular card photos',
      'reviewer-photos/board.png': new Uint8Array([0, 1, 2, 255]),
    });

    const exitCode = await runFaceAuditCli([
      'hash-source',
      'reviewer-photos/regular-cards.zip',
      'reviewer-photos/board.png',
    ], io);
    const result = JSON.parse(io.stdout) as {
      artifactType: string;
      version: number;
      algorithm: string;
      sourceCount: number;
      sources: Array<{locator: string; contentHash: string}>;
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(result).toEqual({
      artifactType: 'face_audit_evidence_source_hashes',
      version: 1,
      algorithm: 'sha256',
      sourceCount: 2,
      sources: [
        {
          locator: 'reviewer-photos/regular-cards.zip',
          contentHash: 'sha256:ed805955cfc9b2ff646db3506535a88b17e7d45e98b91dc73bccb1394bf66c3c',
        },
        {
          locator: 'reviewer-photos/board.png',
          contentHash: 'sha256:3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56',
        },
      ],
    });
  });

  it('prints complete evidence source templates for local official-component files', async () => {
    const io = new MemoryFaceAuditCliIO({
      'reviewer-photos/Official Board Scan.PNG': new Uint8Array([0, 1, 2, 255]),
      'archive-a/regular-cards.zip': 'regular card photos',
      'archive-b/regular-cards.zip': 'alternate regular card photos',
    });

    const exitCode = await runFaceAuditCli([
      'source-template',
      'official_high_res_component_image',
      'reviewer-photos/Official Board Scan.PNG',
      'archive-a/regular-cards.zip',
      'archive-b/regular-cards.zip',
    ], io);
    const result = JSON.parse(io.stdout) as {
      artifactType: string;
      version: number;
      sourceType: string;
      sourceCount: number;
      evidenceSources: Array<{
        id: string;
        label: string;
        sourceType: string;
        citation: string;
        locator: string;
        contentHash: string;
        notes: string;
      }>;
    };

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(result.artifactType).toBe('face_audit_evidence_source_template');
    expect(result.version).toBe(1);
    expect(result.sourceType).toBe('official_high_res_component_image');
    expect(result.sourceCount).toBe(3);
    expect(result.evidenceSources).toEqual([
      {
        id: 'official-board-scan',
        label: 'Official Board Scan.PNG',
        sourceType: 'official_high_res_component_image',
        citation: 'Official Brass: Birmingham component evidence: reviewer-photos/Official Board Scan.PNG',
        locator: 'reviewer-photos/Official Board Scan.PNG',
        contentHash: 'sha256:3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56',
        notes: '',
      },
      {
        id: 'regular-cards',
        label: 'regular-cards.zip',
        sourceType: 'official_high_res_component_image',
        citation: 'Official Brass: Birmingham component evidence: archive-a/regular-cards.zip',
        locator: 'archive-a/regular-cards.zip',
        contentHash: 'sha256:ed805955cfc9b2ff646db3506535a88b17e7d45e98b91dc73bccb1394bf66c3c',
        notes: '',
      },
      {
        id: 'regular-cards-2',
        label: 'regular-cards.zip',
        sourceType: 'official_high_res_component_image',
        citation: 'Official Brass: Birmingham component evidence: archive-b/regular-cards.zip',
        locator: 'archive-b/regular-cards.zip',
        contentHash: 'sha256:fb19a7b850de23acb90581ea0f857800143e51569bbf9a045ae070d5fbfc7a35',
        notes: '',
      },
    ]);
  });

  it('prints source-id maps for full match review artifacts by area', async () => {
    const sourceArtifact = {
      ...evidenceSourceTemplateArtifact(),
      sourceCount: 3,
      evidenceSources: [
        evidenceSourceTemplateArtifact().evidenceSources[0],
        {
          ...evidenceSourceTemplateArtifact().evidenceSources[0],
          id: 'tiles-source',
          label: 'Tile evidence',
          locator: 'reviewer-photos/tiles.zip',
        },
        {
          ...evidenceSourceTemplateArtifact().evidenceSources[0],
          id: 'board-source',
          label: 'Board evidence',
          locator: 'reviewer-photos/board.png',
        },
      ],
    };
    const io = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(sourceArtifact),
    });

    const exitCode = await runFaceAuditCli([
      'source-ids-by-area-template',
      'sources.json',
      'photo-set',
      'industryTiles=tiles-source',
      'linkLines=board-source',
      'locationsAndSlots=board-source',
    ], io);
    const result = JSON.parse(io.stdout) as Record<string, string>;

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(result).toEqual({
      ...Object.fromEntries(FACE_AUDIT_AREAS.map((area) => [area, 'photo-set'])),
      industryTiles: 'tiles-source',
      linkLines: 'board-source',
      locationsAndSlots: 'board-source',
    });
  });

  it('prints official-component evidenceRef templates for declared evidence sources', async () => {
    const areaIO = new MemoryFaceAuditCliIO();
    const areaExitCode = await runFaceAuditCli([
      'evidence-ref-template',
      'photo-set',
      'regularCards',
    ], areaIO);
    const areaResult = JSON.parse(areaIO.stdout) as {
      artifactType: string;
      version: number;
      sourceId: string;
      area: string;
      mode: string;
      evidenceRefCount: number;
      evidenceRefs: string[];
      items: unknown[];
    };

    expect(areaExitCode).toBe(0);
    expect(areaIO.stderr).toBe('');
    expect(areaResult).toEqual({
      artifactType: 'face_audit_evidence_ref_template',
      version: 1,
      sourceId: 'photo-set',
      area: 'regularCards',
      mode: 'area',
      evidenceRefCount: 1,
      evidenceRefs: ['official-component:photo-set#regularCards'],
      items: [],
    });

    const itemsIO = new MemoryFaceAuditCliIO();
    const itemsExitCode = await runFaceAuditCli([
      'evidence-ref-template',
      'photo-set',
      'wildCards',
      'items',
    ], itemsIO);
    const itemsResult = JSON.parse(itemsIO.stdout) as {
      artifactType: string;
      version: number;
      sourceId: string;
      area: string;
      mode: string;
      evidenceRefCount: number;
      evidenceRefs: string[];
      items: Array<{key: string; id: string; label: string; evidenceRef: string}>;
    };

    expect(itemsExitCode).toBe(0);
    expect(itemsIO.stderr).toBe('');
    expect(itemsResult.artifactType).toBe('face_audit_evidence_ref_template');
    expect(itemsResult.version).toBe(1);
    expect(itemsResult.sourceId).toBe('photo-set');
    expect(itemsResult.area).toBe('wildCards');
    expect(itemsResult.mode).toBe('items');
    expect(itemsResult.evidenceRefCount).toBe(8);
    expect(itemsResult.items).toHaveLength(8);
    expect(itemsResult.evidenceRefs).toEqual(itemsResult.items.map((item) => item.evidenceRef));
    expect(itemsResult.items[0]).toEqual({
      key: expect.stringMatching(/^wildCards:/),
      id: expect.any(String),
      label: expect.any(String),
      evidenceRef: expect.stringMatching(/^official-component:photo-set#wildCards:/),
    });
  });

  it('prints filled matching area review artifacts from declared evidence sources', async () => {
    const sourceArtifact = evidenceSourceTemplateArtifact();
    const areaIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(sourceArtifact),
    });
    const areaExitCode = await runFaceAuditCli([
      'area-match-template',
      'regularCards',
      'sources.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
    ], areaIO);
    const areaResult = JSON.parse(areaIO.stdout) as ReturnType<typeof buildFaceAuditAreaReviewTemplate>;

    expect(areaExitCode).toBe(0);
    expect(areaIO.stderr).toBe('');
    expect(areaResult.artifactType).toBe('face_audit_area_review');
    expect(areaResult.area).toBe('regularCards');
    expect(areaResult.evidenceSources).toEqual(sourceArtifact.evidenceSources);
    expect(areaResult.items).toHaveLength(64);
    expect(areaResult.items.every((item) => item.reviewStatus === 'matches_official_face')).toBe(true);
    expect(areaResult.items.every((item) => item.reviewer === 'Ada')).toBe(true);
    expect(areaResult.items.every((item) => item.reviewedAt === '2026-07-10T00:00:00.000Z')).toBe(true);
    expect(areaResult.items.every((item) => item.evidenceRef === 'official-component:photo-set#regularCards')).toBe(true);
    expect(areaResult.completion).toMatchObject({
      status: 'ready_to_lock',
      reviewedItemCount: 64,
      matchingItemCount: 64,
      unreviewedItemCount: 0,
    });

    const itemsIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(sourceArtifact),
    });
    const itemsExitCode = await runFaceAuditCli([
      'area-match-template',
      'wildCards',
      'sources.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
      'items',
    ], itemsIO);
    const itemsResult = JSON.parse(itemsIO.stdout) as ReturnType<typeof buildFaceAuditAreaReviewTemplate>;

    expect(itemsExitCode).toBe(0);
    expect(itemsIO.stderr).toBe('');
    expect(itemsResult.area).toBe('wildCards');
    expect(itemsResult.items).toHaveLength(8);
    expect(itemsResult.items.every((item) =>
      item.evidenceRef === `official-component:photo-set#wildCards:${item.id}`,
    )).toBe(true);
    expect(itemsResult.completion.status).toBe('ready_to_lock');
  });

  it('prints filled matching full review artifacts from declared evidence sources', async () => {
    const sourceArtifact = evidenceSourceTemplateArtifact();
    const areaRefIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(sourceArtifact),
    });
    const areaRefExitCode = await runFaceAuditCli([
      'review-match-template',
      'sources.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
    ], areaRefIO);
    const areaRefResult = JSON.parse(areaRefIO.stdout) as ReturnType<typeof buildFaceAuditReviewTemplate>;

    expect(areaRefExitCode).toBe(0);
    expect(areaRefIO.stderr).toBe('');
    expect(areaRefResult.version).toBe(1);
    expect(areaRefResult.checklistItemCount).toBe(185);
    expect(areaRefResult.evidenceSources).toEqual(sourceArtifact.evidenceSources);
    expect(areaRefResult.items).toHaveLength(185);
    expect(areaRefResult.items.every((item) => item.reviewStatus === 'matches_official_face')).toBe(true);
    expect(areaRefResult.items.every((item) => item.reviewer === 'Ada')).toBe(true);
    expect(areaRefResult.items.every((item) => item.reviewedAt === '2026-07-10T00:00:00.000Z')).toBe(true);
    expect(areaRefResult.items.every((item) => item.evidenceRef === `official-component:photo-set#${item.area}`)).toBe(true);
    expect(areaRefResult.completion).toMatchObject({
      status: 'ready_to_lock',
      reviewedItemCount: 185,
      matchingItemCount: 185,
      unreviewedItemCount: 0,
    });

    const itemRefIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(sourceArtifact),
    });
    const itemRefExitCode = await runFaceAuditCli([
      'review-match-template',
      'sources.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
      'items',
    ], itemRefIO);
    const itemRefResult = JSON.parse(itemRefIO.stdout) as ReturnType<typeof buildFaceAuditReviewTemplate>;

    expect(itemRefExitCode).toBe(0);
    expect(itemRefIO.stderr).toBe('');
    expect(itemRefResult.items).toHaveLength(185);
    expect(itemRefResult.items.every((item) =>
      item.evidenceRef === `official-component:photo-set#${item.area}:${item.id}`,
    )).toBe(true);
    expect(itemRefResult.completion.status).toBe('ready_to_lock');
  });

  it('prints filled matching full review artifacts with mapped per-area evidence sources', async () => {
    const sourceArtifact = evidenceSourceTemplateArtifact();
    const mappedSources = FACE_AUDIT_AREAS.map((area) => ({
      ...sourceArtifact.evidenceSources[0],
      id: `${area}-source`,
      label: `${area} official component evidence`,
      locator: `reviewer-photos/${area}.zip`,
    }));
    const sourceIdsByArea = Object.fromEntries(FACE_AUDIT_AREAS.map((area) => [
      area,
      `${area}-source`,
    ])) as Record<FaceAuditArea, string>;
    const io = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({...sourceArtifact, evidenceSources: mappedSources}),
      'source-ids-by-area.json': JSON.stringify(sourceIdsByArea),
    });

    const exitCode = await runFaceAuditCli([
      'review-match-template-by-area',
      'sources.json',
      'source-ids-by-area.json',
      'Ada',
      '2026-07-10T00:00:00.000Z',
      'items',
    ], io);
    const result = JSON.parse(io.stdout) as ReturnType<typeof buildFaceAuditReviewTemplate>;

    expect(exitCode).toBe(0);
    expect(io.stderr).toBe('');
    expect(result.evidenceSources).toEqual(mappedSources);
    expect(result.items).toHaveLength(185);
    expect(result.items.every((item) =>
      item.evidenceRef === `official-component:${sourceIdsByArea[item.area]}#${item.area}:${item.id}`,
    )).toBe(true);
    expect(result.completion.status).toBe('ready_to_lock');
  });

  it('round-trips generated full match reviews through ready, lock, verification, and release gates', async () => {
    const sourceArtifact = evidenceSourceTemplateArtifact();
    const templateIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(sourceArtifact),
    });
    const templateExitCode = await runFaceAuditCli([
      'review-match-template',
      'sources.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
      'items',
    ], templateIO);
    const reviewArtifact = JSON.parse(templateIO.stdout) as ReturnType<typeof buildFaceAuditReviewTemplate>;

    expect(templateExitCode).toBe(0);
    expect(templateIO.stderr).toBe('');
    expect(reviewArtifact.completion.status).toBe('ready_to_lock');

    const readyIO = new MemoryFaceAuditCliIO({
      'review.json': JSON.stringify(reviewArtifact),
    });
    const readyExitCode = await runFaceAuditCli(['ready', 'review.json'], readyIO);
    const readyResult = JSON.parse(readyIO.stdout) as {
      ok: boolean;
      issues: unknown[];
      review: ReturnType<typeof buildFaceAuditReviewTemplate>;
    };

    expect(readyExitCode).toBe(0);
    expect(readyIO.stderr).toBe('');
    expect(readyResult.ok).toBe(true);
    expect(readyResult.issues).toEqual([]);
    expect(readyResult.review.completion.status).toBe('ready_to_lock');

    const lockIO = new MemoryFaceAuditCliIO({
      'review.json': JSON.stringify(reviewArtifact),
    });
    const lockExitCode = await runFaceAuditCli(['lock-artifact', 'review.json'], lockIO);
    const lockArtifact = JSON.parse(lockIO.stdout) as {
      artifactType: string;
      version: number;
      completion: {status: string};
      areas: Array<{evidenceRefCount: number; itemSpecificEvidenceRefCount: number}>;
    };

    expect(lockExitCode).toBe(0);
    expect(lockIO.stderr).toBe('');
    expect(lockArtifact.artifactType).toBe('face_audit_lock_evidence');
    expect(lockArtifact.version).toBe(1);
    expect(lockArtifact.completion.status).toBe('ready_to_lock');
    expect(lockArtifact.areas.every((area) => area.evidenceRefCount > 0)).toBe(true);
    expect(lockArtifact.areas.every((area) => area.itemSpecificEvidenceRefCount > 0)).toBe(true);

    const verifyIO = new MemoryFaceAuditCliIO({
      'lock.json': JSON.stringify(lockArtifact),
    });
    const verifyExitCode = await runFaceAuditCli(['verify-lock-artifact', 'lock.json'], verifyIO);
    const verifyResult = JSON.parse(verifyIO.stdout) as {ok: boolean; issues: unknown[]};

    expect(verifyExitCode).toBe(0);
    expect(verifyIO.stderr).toBe('');
    expect(verifyResult.ok).toBe(true);
    expect(verifyResult.issues).toEqual([]);

    const releaseGateIO = new MemoryFaceAuditCliIO({
      'lock.json': JSON.stringify(lockArtifact),
    });
    const releaseGateExitCode = await runFaceAuditCli(['release-gate', 'lock.json'], releaseGateIO);
    const releaseGateResult = JSON.parse(releaseGateIO.stdout) as {
      ok: boolean;
      lockArtifactValidation?: {ok: boolean};
      issues: unknown[];
    };

    expect(releaseGateExitCode).toBe(0);
    expect(releaseGateIO.stderr).toBe('');
    expect(releaseGateResult.ok).toBe(true);
    expect(releaseGateResult.lockArtifactValidation?.ok).toBe(true);
    expect(releaseGateResult.issues).toEqual([]);
  });

  it('returns a command error when a review artifact file is missing or malformed', async () => {
    const missingFileIO = new MemoryFaceAuditCliIO();
    const missingExitCode = await runFaceAuditCli(['validate', 'missing.json'], missingFileIO);

    expect(missingExitCode).toBe(2);
    expect(missingFileIO.stdout).toBe('');
    expect(missingFileIO.stderr).toContain('Could not read a valid review artifact JSON file');

    const malformedIO = new MemoryFaceAuditCliIO({'review.json': '{not-json'});
    const malformedExitCode = await runFaceAuditCli(['validate', 'review.json'], malformedIO);

    expect(malformedExitCode).toBe(2);
    expect(malformedIO.stdout).toBe('');
    expect(malformedIO.stderr).toContain('Could not read a valid review artifact JSON file');

    const missingHashSourceArgIO = new MemoryFaceAuditCliIO();
    const missingHashSourceArgExitCode = await runFaceAuditCli(['hash-source'], missingHashSourceArgIO);

    expect(missingHashSourceArgExitCode).toBe(2);
    expect(missingHashSourceArgIO.stdout).toBe('');
    expect(missingHashSourceArgIO.stderr).toContain('The hash-source command expects at least one evidence file path.');

    const missingEvidenceFileIO = new MemoryFaceAuditCliIO();
    const missingEvidenceFileExitCode = await runFaceAuditCli(['hash-source', 'missing.png'], missingEvidenceFileIO);

    expect(missingEvidenceFileExitCode).toBe(2);
    expect(missingEvidenceFileIO.stdout).toBe('');
    expect(missingEvidenceFileIO.stderr).toContain('Could not read evidence source file');

    const invalidSourceTypeIO = new MemoryFaceAuditCliIO();
    const invalidSourceTypeExitCode = await runFaceAuditCli(['source-template', 'community_scan', 'board.png'], invalidSourceTypeIO);

    expect(invalidSourceTypeExitCode).toBe(2);
    expect(invalidSourceTypeIO.stdout).toBe('');
    expect(invalidSourceTypeIO.stderr)
      .toContain('The source-template command expects source type official_physical_component or official_high_res_component_image.');

    const missingSourceTemplateArgIO = new MemoryFaceAuditCliIO();
    const missingSourceTemplateArgExitCode = await runFaceAuditCli([
      'source-template',
      'official_physical_component',
    ], missingSourceTemplateArgIO);

    expect(missingSourceTemplateArgExitCode).toBe(2);
    expect(missingSourceTemplateArgIO.stdout).toBe('');
    expect(missingSourceTemplateArgIO.stderr).toContain('The source-template command expects at least one evidence file path.');

    const missingSourceTemplateFileIO = new MemoryFaceAuditCliIO();
    const missingSourceTemplateFileExitCode = await runFaceAuditCli([
      'source-template',
      'official_physical_component',
      'missing.png',
    ], missingSourceTemplateFileIO);

    expect(missingSourceTemplateFileExitCode).toBe(2);
    expect(missingSourceTemplateFileIO.stdout).toBe('');
    expect(missingSourceTemplateFileIO.stderr).toContain('Could not read evidence source file');

    const missingSourceIdsByAreaArgsIO = new MemoryFaceAuditCliIO();
    const missingSourceIdsByAreaArgsExitCode = await runFaceAuditCli([
      'source-ids-by-area-template',
      'sources.json',
    ], missingSourceIdsByAreaArgsIO);

    expect(missingSourceIdsByAreaArgsExitCode).toBe(2);
    expect(missingSourceIdsByAreaArgsIO.stdout).toBe('');
    expect(missingSourceIdsByAreaArgsIO.stderr)
      .toContain('The source-ids-by-area-template command expects source artifact JSON file, default source id, and optional area=source-id overrides.');

    const invalidSourceIdsByAreaArtifactIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({sources: []}),
    });
    const invalidSourceIdsByAreaArtifactExitCode = await runFaceAuditCli([
      'source-ids-by-area-template',
      'sources.json',
      'photo-set',
    ], invalidSourceIdsByAreaArtifactIO);

    expect(invalidSourceIdsByAreaArtifactExitCode).toBe(2);
    expect(invalidSourceIdsByAreaArtifactIO.stdout).toBe('');
    expect(invalidSourceIdsByAreaArtifactIO.stderr)
      .toContain('The source-ids-by-area-template command source artifact must include an evidenceSources array.');

    const undeclaredSourceIdsByAreaDefaultIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(evidenceSourceTemplateArtifact()),
    });
    const undeclaredSourceIdsByAreaDefaultExitCode = await runFaceAuditCli([
      'source-ids-by-area-template',
      'sources.json',
      'missing-source',
    ], undeclaredSourceIdsByAreaDefaultIO);

    expect(undeclaredSourceIdsByAreaDefaultExitCode).toBe(2);
    expect(undeclaredSourceIdsByAreaDefaultIO.stdout).toBe('');
    expect(undeclaredSourceIdsByAreaDefaultIO.stderr)
      .toContain('The source-ids-by-area-template command default source id is not declared in the source artifact: missing-source');

    const invalidSourceIdsByAreaOverrideIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(evidenceSourceTemplateArtifact()),
    });
    const invalidSourceIdsByAreaOverrideExitCode = await runFaceAuditCli([
      'source-ids-by-area-template',
      'sources.json',
      'photo-set',
      'regularCards',
    ], invalidSourceIdsByAreaOverrideIO);

    expect(invalidSourceIdsByAreaOverrideExitCode).toBe(2);
    expect(invalidSourceIdsByAreaOverrideIO.stdout).toBe('');
    expect(invalidSourceIdsByAreaOverrideIO.stderr)
      .toContain('The source-ids-by-area-template command overrides must use area=source-id.');

    const undeclaredSourceIdsByAreaOverrideIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(evidenceSourceTemplateArtifact()),
    });
    const undeclaredSourceIdsByAreaOverrideExitCode = await runFaceAuditCli([
      'source-ids-by-area-template',
      'sources.json',
      'photo-set',
      'regularCards=missing-source',
    ], undeclaredSourceIdsByAreaOverrideIO);

    expect(undeclaredSourceIdsByAreaOverrideExitCode).toBe(2);
    expect(undeclaredSourceIdsByAreaOverrideIO.stdout).toBe('');
    expect(undeclaredSourceIdsByAreaOverrideIO.stderr)
      .toContain('The source-ids-by-area-template command source id for regularCards is not declared in the source artifact: missing-source');

    const missingTemplateWithSourcesArgsIO = new MemoryFaceAuditCliIO();
    const missingTemplateWithSourcesArgsExitCode = await runFaceAuditCli([
      'template-with-sources',
    ], missingTemplateWithSourcesArgsIO);

    expect(missingTemplateWithSourcesArgsExitCode).toBe(2);
    expect(missingTemplateWithSourcesArgsIO.stdout).toBe('');
    expect(missingTemplateWithSourcesArgsIO.stderr)
      .toContain('The template-with-sources command expects exactly one source artifact JSON file.');

    const invalidTemplateWithSourcesArtifactIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({sources: []}),
    });
    const invalidTemplateWithSourcesArtifactExitCode = await runFaceAuditCli([
      'template-with-sources',
      'sources.json',
    ], invalidTemplateWithSourcesArtifactIO);

    expect(invalidTemplateWithSourcesArtifactExitCode).toBe(2);
    expect(invalidTemplateWithSourcesArtifactIO.stdout).toBe('');
    expect(invalidTemplateWithSourcesArtifactIO.stderr)
      .toContain('The template-with-sources command source artifact must include an evidenceSources array.');

    const missingAreaTemplateWithSourcesArgsIO = new MemoryFaceAuditCliIO();
    const missingAreaTemplateWithSourcesArgsExitCode = await runFaceAuditCli([
      'area-template-with-sources',
      'regularCards',
    ], missingAreaTemplateWithSourcesArgsIO);

    expect(missingAreaTemplateWithSourcesArgsExitCode).toBe(2);
    expect(missingAreaTemplateWithSourcesArgsIO.stdout).toBe('');
    expect(missingAreaTemplateWithSourcesArgsIO.stderr)
      .toContain('The area-template-with-sources command expects a face-audit area and one source artifact JSON file.');

    const invalidAreaTemplateWithSourcesAreaIO = new MemoryFaceAuditCliIO();
    const invalidAreaTemplateWithSourcesAreaExitCode = await runFaceAuditCli([
      'area-template-with-sources',
      'unknownArea',
      'sources.json',
    ], invalidAreaTemplateWithSourcesAreaIO);

    expect(invalidAreaTemplateWithSourcesAreaExitCode).toBe(2);
    expect(invalidAreaTemplateWithSourcesAreaIO.stdout).toBe('');
    expect(invalidAreaTemplateWithSourcesAreaIO.stderr).toContain('Unknown face-audit area: unknownArea');

    const invalidAreaTemplateWithSourcesArtifactIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({sources: []}),
    });
    const invalidAreaTemplateWithSourcesArtifactExitCode = await runFaceAuditCli([
      'area-template-with-sources',
      'regularCards',
      'sources.json',
    ], invalidAreaTemplateWithSourcesArtifactIO);

    expect(invalidAreaTemplateWithSourcesArtifactExitCode).toBe(2);
    expect(invalidAreaTemplateWithSourcesArtifactIO.stdout).toBe('');
    expect(invalidAreaTemplateWithSourcesArtifactIO.stderr)
      .toContain('The area-template-with-sources command source artifact must include an evidenceSources array.');

    const missingEvidenceRefArgsIO = new MemoryFaceAuditCliIO();
    const missingEvidenceRefArgsExitCode = await runFaceAuditCli([
      'evidence-ref-template',
      'photo-set',
    ], missingEvidenceRefArgsIO);

    expect(missingEvidenceRefArgsExitCode).toBe(2);
    expect(missingEvidenceRefArgsIO.stdout).toBe('');
    expect(missingEvidenceRefArgsIO.stderr)
      .toContain('The evidence-ref-template command expects source id, face-audit area, and optional mode area or items.');

    const invalidEvidenceRefSourceIdIO = new MemoryFaceAuditCliIO();
    const invalidEvidenceRefSourceIdExitCode = await runFaceAuditCli([
      'evidence-ref-template',
      'bad source',
      'regularCards',
    ], invalidEvidenceRefSourceIdIO);

    expect(invalidEvidenceRefSourceIdExitCode).toBe(2);
    expect(invalidEvidenceRefSourceIdIO.stdout).toBe('');
    expect(invalidEvidenceRefSourceIdIO.stderr)
      .toContain('The evidence-ref-template command expects a source id matching the evidenceRef source id format.');

    const invalidEvidenceRefAreaIO = new MemoryFaceAuditCliIO();
    const invalidEvidenceRefAreaExitCode = await runFaceAuditCli([
      'evidence-ref-template',
      'photo-set',
      'unknownArea',
    ], invalidEvidenceRefAreaIO);

    expect(invalidEvidenceRefAreaExitCode).toBe(2);
    expect(invalidEvidenceRefAreaIO.stdout).toBe('');
    expect(invalidEvidenceRefAreaIO.stderr).toContain('Unknown face-audit area: unknownArea');

    const invalidEvidenceRefModeIO = new MemoryFaceAuditCliIO();
    const invalidEvidenceRefModeExitCode = await runFaceAuditCli([
      'evidence-ref-template',
      'photo-set',
      'regularCards',
      'sources',
    ], invalidEvidenceRefModeIO);

    expect(invalidEvidenceRefModeExitCode).toBe(2);
    expect(invalidEvidenceRefModeIO.stdout).toBe('');
    expect(invalidEvidenceRefModeIO.stderr).toContain('The evidence-ref-template command mode must be area or items.');

    const missingAreaMatchArgsIO = new MemoryFaceAuditCliIO();
    const missingAreaMatchArgsExitCode = await runFaceAuditCli([
      'area-match-template',
      'regularCards',
      'sources.json',
      'photo-set',
    ], missingAreaMatchArgsIO);

    expect(missingAreaMatchArgsExitCode).toBe(2);
    expect(missingAreaMatchArgsIO.stdout).toBe('');
    expect(missingAreaMatchArgsIO.stderr)
      .toContain('The area-match-template command expects area, source artifact JSON file, source id, reviewer, reviewed-at timestamp, and optional mode area or items.');

    const missingAreaMatchSourceIO = new MemoryFaceAuditCliIO();
    const missingAreaMatchSourceExitCode = await runFaceAuditCli([
      'area-match-template',
      'regularCards',
      'missing.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
    ], missingAreaMatchSourceIO);

    expect(missingAreaMatchSourceExitCode).toBe(2);
    expect(missingAreaMatchSourceIO.stdout).toBe('');
    expect(missingAreaMatchSourceIO.stderr).toContain('Could not read a valid source artifact JSON file');

    const invalidAreaMatchSourceArtifactIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({sources: []}),
    });
    const invalidAreaMatchSourceArtifactExitCode = await runFaceAuditCli([
      'area-match-template',
      'regularCards',
      'sources.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
    ], invalidAreaMatchSourceArtifactIO);

    expect(invalidAreaMatchSourceArtifactExitCode).toBe(2);
    expect(invalidAreaMatchSourceArtifactIO.stdout).toBe('');
    expect(invalidAreaMatchSourceArtifactIO.stderr)
      .toContain('The area-match-template command source artifact must include an evidenceSources array.');

    const undeclaredAreaMatchSourceIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({evidenceSources: [{id: 'other-photo-set'}]}),
    });
    const undeclaredAreaMatchSourceExitCode = await runFaceAuditCli([
      'area-match-template',
      'regularCards',
      'sources.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
    ], undeclaredAreaMatchSourceIO);

    expect(undeclaredAreaMatchSourceExitCode).toBe(2);
    expect(undeclaredAreaMatchSourceIO.stdout).toBe('');
    expect(undeclaredAreaMatchSourceIO.stderr)
      .toContain('The area-match-template command source id is not declared in the source artifact: photo-set');

    const invalidAreaMatchTimestampIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({evidenceSources: [{id: 'photo-set'}]}),
    });
    const invalidAreaMatchTimestampExitCode = await runFaceAuditCli([
      'area-match-template',
      'regularCards',
      'sources.json',
      'photo-set',
      'Ada',
      'not-a-date',
    ], invalidAreaMatchTimestampIO);

    expect(invalidAreaMatchTimestampExitCode).toBe(2);
    expect(invalidAreaMatchTimestampIO.stdout).toBe('');
    expect(invalidAreaMatchTimestampIO.stderr)
      .toContain('The area-match-template command expects reviewed-at to be a parseable timestamp.');

    const invalidAreaMatchModeIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({evidenceSources: [{id: 'photo-set'}]}),
    });
    const invalidAreaMatchModeExitCode = await runFaceAuditCli([
      'area-match-template',
      'regularCards',
      'sources.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
      'refs',
    ], invalidAreaMatchModeIO);

    expect(invalidAreaMatchModeExitCode).toBe(2);
    expect(invalidAreaMatchModeIO.stdout).toBe('');
    expect(invalidAreaMatchModeIO.stderr).toContain('The area-match-template command mode must be area or items.');

    const missingReviewMatchArgsIO = new MemoryFaceAuditCliIO();
    const missingReviewMatchArgsExitCode = await runFaceAuditCli([
      'review-match-template',
      'sources.json',
      'photo-set',
    ], missingReviewMatchArgsIO);

    expect(missingReviewMatchArgsExitCode).toBe(2);
    expect(missingReviewMatchArgsIO.stdout).toBe('');
    expect(missingReviewMatchArgsIO.stderr)
      .toContain('The review-match-template command expects source artifact JSON file, source id, reviewer, reviewed-at timestamp, and optional mode area or items.');

    const invalidReviewMatchSourceArtifactIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({sources: []}),
    });
    const invalidReviewMatchSourceArtifactExitCode = await runFaceAuditCli([
      'review-match-template',
      'sources.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
    ], invalidReviewMatchSourceArtifactIO);

    expect(invalidReviewMatchSourceArtifactExitCode).toBe(2);
    expect(invalidReviewMatchSourceArtifactIO.stdout).toBe('');
    expect(invalidReviewMatchSourceArtifactIO.stderr)
      .toContain('The review-match-template command source artifact must include an evidenceSources array.');

    const undeclaredReviewMatchSourceIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({evidenceSources: [{id: 'other-photo-set'}]}),
    });
    const undeclaredReviewMatchSourceExitCode = await runFaceAuditCli([
      'review-match-template',
      'sources.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
    ], undeclaredReviewMatchSourceIO);

    expect(undeclaredReviewMatchSourceExitCode).toBe(2);
    expect(undeclaredReviewMatchSourceIO.stdout).toBe('');
    expect(undeclaredReviewMatchSourceIO.stderr)
      .toContain('The review-match-template command source id is not declared in the source artifact: photo-set');

    const invalidReviewMatchTimestampIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({evidenceSources: [{id: 'photo-set'}]}),
    });
    const invalidReviewMatchTimestampExitCode = await runFaceAuditCli([
      'review-match-template',
      'sources.json',
      'photo-set',
      'Ada',
      'not-a-date',
    ], invalidReviewMatchTimestampIO);

    expect(invalidReviewMatchTimestampExitCode).toBe(2);
    expect(invalidReviewMatchTimestampIO.stdout).toBe('');
    expect(invalidReviewMatchTimestampIO.stderr)
      .toContain('The review-match-template command expects reviewed-at to be a parseable timestamp.');

    const invalidReviewMatchModeIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({evidenceSources: [{id: 'photo-set'}]}),
    });
    const invalidReviewMatchModeExitCode = await runFaceAuditCli([
      'review-match-template',
      'sources.json',
      'photo-set',
      'Ada',
      '2026-07-10T00:00:00.000Z',
      'refs',
    ], invalidReviewMatchModeIO);

    expect(invalidReviewMatchModeExitCode).toBe(2);
    expect(invalidReviewMatchModeIO.stdout).toBe('');
    expect(invalidReviewMatchModeIO.stderr).toContain('The review-match-template command mode must be area or items.');

    const missingMappedReviewMatchArgsIO = new MemoryFaceAuditCliIO();
    const missingMappedReviewMatchArgsExitCode = await runFaceAuditCli([
      'review-match-template-by-area',
      'sources.json',
      'source-ids-by-area.json',
    ], missingMappedReviewMatchArgsIO);

    expect(missingMappedReviewMatchArgsExitCode).toBe(2);
    expect(missingMappedReviewMatchArgsIO.stdout).toBe('');
    expect(missingMappedReviewMatchArgsIO.stderr)
      .toContain('The review-match-template-by-area command expects source artifact JSON file, source-ids-by-area JSON file, reviewer, reviewed-at timestamp, and optional mode area or items.');

    const invalidMappedReviewMatchSourceArtifactIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify({sources: []}),
      'source-ids-by-area.json': JSON.stringify({regularCards: 'photo-set'}),
    });
    const invalidMappedReviewMatchSourceArtifactExitCode = await runFaceAuditCli([
      'review-match-template-by-area',
      'sources.json',
      'source-ids-by-area.json',
      'Ada',
      '2026-07-10T00:00:00.000Z',
    ], invalidMappedReviewMatchSourceArtifactIO);

    expect(invalidMappedReviewMatchSourceArtifactExitCode).toBe(2);
    expect(invalidMappedReviewMatchSourceArtifactIO.stdout).toBe('');
    expect(invalidMappedReviewMatchSourceArtifactIO.stderr)
      .toContain('The review-match-template-by-area command source artifact must include an evidenceSources array.');

    const invalidMappedReviewMatchMapIO = new MemoryFaceAuditCliIO({
      'sources.json': JSON.stringify(evidenceSourceTemplateArtifact()),
      'source-ids-by-area.json': JSON.stringify({
        regularCards: 'bad source',
        wildCards: 'missing-source',
      }),
    });
    const invalidMappedReviewMatchMapExitCode = await runFaceAuditCli([
      'review-match-template-by-area',
      'sources.json',
      'source-ids-by-area.json',
      'Ada',
      '2026-07-10T00:00:00.000Z',
    ], invalidMappedReviewMatchMapIO);
    const invalidMappedReviewMatchMapResult = JSON.parse(invalidMappedReviewMatchMapIO.stdout) as {
      ok: boolean;
      issues: Array<{field: string}>;
    };

    expect(invalidMappedReviewMatchMapExitCode).toBe(1);
    expect(invalidMappedReviewMatchMapIO.stderr).toBe('');
    expect(invalidMappedReviewMatchMapResult.ok).toBe(false);
    expect(invalidMappedReviewMatchMapResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({field: 'sourceIdsByArea.regularCards'}),
      expect.objectContaining({field: 'sourceIdsByArea.wildCards'}),
      expect.objectContaining({field: 'sourceIdsByArea.industryTiles'}),
    ]));
  });

  it('prints help and rejects invalid argument shapes', async () => {
    const helpIO = new MemoryFaceAuditCliIO();
    expect(await runFaceAuditCli(['--help'], helpIO)).toBe(0);
    expect(helpIO.stdout).toContain('faceAuditCli area-template <area>');
    expect(helpIO.stdout).toContain('faceAuditCli template-with-sources <source-artifact.json>');
    expect(helpIO.stdout).toContain('faceAuditCli area-template-with-sources <area> <source-artifact.json>');
    expect(helpIO.stdout).toContain('faceAuditCli merge <review-artifact.json>...');
    expect(helpIO.stdout).toContain('faceAuditCli status [review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli todo [--summary] [--area <area>] [review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli review-plan [review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli review-sheet [review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli area-review-sheet <area> [review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli apply-review-sheet <review-sheet.tsv> [review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli reviewer-instructions [review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli area-reviewer-instructions <area> [review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli ci-artifacts <output-dir> [review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli verify-ci-artifacts <output-dir>');
    expect(helpIO.stdout).toContain('faceAuditCli ci-artifacts-self-check [review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli handoff [review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli verify-handoff <handoff-artifact.json>');
    expect(helpIO.stdout).toContain('faceAuditCli handoff-response <handoff-artifact.json> [area-review-artifact.json]...');
    expect(helpIO.stdout).toContain('faceAuditCli validate <review-artifact.json>');
    expect(helpIO.stdout).toContain('faceAuditCli ready <review-artifact.json>');
    expect(helpIO.stdout).toContain('faceAuditCli lock-preview <review-artifact.json>');
    expect(helpIO.stdout).toContain('faceAuditCli lock-artifact <review-artifact.json>');
    expect(helpIO.stdout).toContain('faceAuditCli verify-lock-artifact <lock-artifact.json>');
    expect(helpIO.stdout).toContain('faceAuditCli release-gate [lock-artifact.json]');
    expect(helpIO.stdout).toContain('faceAuditCli hash-source <evidence-file>...');
    expect(helpIO.stdout).toContain('faceAuditCli source-template <source-type> <evidence-file>...');
    expect(helpIO.stdout)
      .toContain('faceAuditCli source-ids-by-area-template <source-artifact.json> <default-source-id> [area=source-id]...');
    expect(helpIO.stdout).toContain('faceAuditCli evidence-ref-template <source-id> <area> [area|items]');
    expect(helpIO.stdout)
      .toContain('faceAuditCli area-match-template <area> <source-artifact.json> <source-id> <reviewer> <reviewed-at> [area|items]');
    expect(helpIO.stdout)
      .toContain('faceAuditCli review-match-template <source-artifact.json> <source-id> <reviewer> <reviewed-at> [area|items]');
    expect(helpIO.stdout)
      .toContain('faceAuditCli review-match-template-by-area <source-artifact.json> <source-ids-by-area.json> <reviewer> <reviewed-at> [area|items]');

    const extraArgIO = new MemoryFaceAuditCliIO();
    expect(await runFaceAuditCli(['checklist', 'unexpected.json'], extraArgIO)).toBe(2);
    expect(extraArgIO.stderr).toContain('The checklist command does not accept file arguments.');

    const unknownIO = new MemoryFaceAuditCliIO();
    expect(await runFaceAuditCli(['unknown'], unknownIO)).toBe(2);
    expect(unknownIO.stderr).toContain('Unknown face-audit command: unknown');
  });
});
