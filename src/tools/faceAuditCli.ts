import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {
  applyFaceAuditReviewSheet,
  FACE_AUDIT_EVIDENCE_SOURCE_TYPES,
  buildFaceAuditAreaReviewTemplate,
  buildFaceAuditAreaMatchReviewArtifact,
  buildFaceAuditAreaReviewerInstructions,
  buildFaceAuditAreaReviewerInstructionsReport,
  buildFaceAuditAreaReviewSheet,
  buildFaceAuditAreaReviewTodoSummary,
  buildFaceAuditChecklistExport,
  buildFaceAuditEvidenceRefTemplate,
  buildFaceAuditLockArtifact,
  buildFaceAuditLockPreview,
  buildFaceAuditMappedMatchReviewArtifact,
  buildFaceAuditMatchReviewArtifact,
  buildFaceAuditReviewerHandoff,
  buildFaceAuditReviewerInstructions,
  buildFaceAuditReviewPlan,
  buildFaceAuditReviewSheet,
  buildFaceAuditReviewTodo,
  buildFaceAuditReviewTodoSummary,
  buildFaceAuditReviewTemplate,
  buildFaceAuditSourceIdsByAreaTemplate,
  faceAuditAreaReviewerInstructionsArtifactFileName,
  faceAuditAreaReviewArtifactFileName,
  faceAuditAreaReviewSheetArtifactFileName,
  faceAuditAreaReviewTodoSummaryArtifactFileName,
  mergeFaceAuditReviewArtifacts,
  parseFaceAuditArea,
  parseFaceAuditEvidenceRefMode,
  summarizeFaceAuditReviewerHandoffResponse,
  summarizeFaceAuditReviewStatus,
  validateFaceAuditAreaReviewArtifact,
  validateFaceAuditReviewArtifact,
  validateFaceAuditLockArtifact,
  validateFaceAuditReviewerHandoffArtifact,
  validateFaceAuditReadyArtifact,
  validateFaceAuditStaticLockGate,
  type FaceAuditEvidenceSourceType,
  type FaceAuditReviewerHandoffReport,
  type FaceAuditReviewerInstructionAreaFile,
} from '../common/faceAudit';

export type FaceAuditCliIO = {
  makeDirectory?: (dirPath: string) => Promise<void>;
  makeTempDirectory?: (prefix: string) => Promise<string>;
  removeDirectory?: (dirPath: string) => Promise<void>;
  readBinaryFile?: (filePath: string) => Promise<Uint8Array>;
  readTextFile(filePath: string): Promise<string>;
  writeTextFile?: (filePath: string, text: string) => Promise<void>;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
};

const helpText = [
  'Usage:',
  '  faceAuditCli checklist',
  '  faceAuditCli template',
  '  faceAuditCli area-template <area>',
  '  faceAuditCli template-with-sources <source-artifact.json>',
  '  faceAuditCli area-template-with-sources <area> <source-artifact.json>',
  '  faceAuditCli merge <review-artifact.json>...',
  '  faceAuditCli status [review-artifact.json]...',
  '  faceAuditCli todo [--summary] [--area <area>] [review-artifact.json]...',
  '  faceAuditCli review-plan [review-artifact.json]...',
  '  faceAuditCli review-sheet [review-artifact.json]...',
  '  faceAuditCli area-review-sheet <area> [review-artifact.json]...',
  '  faceAuditCli apply-review-sheet <review-sheet.tsv> [review-artifact.json]...',
  '  faceAuditCli reviewer-instructions [review-artifact.json]...',
  '  faceAuditCli area-reviewer-instructions <area> [review-artifact.json]...',
  '  faceAuditCli ci-artifacts <output-dir> [review-artifact.json]...',
  '  faceAuditCli verify-ci-artifacts <output-dir>',
  '  faceAuditCli ci-artifacts-self-check [review-artifact.json]...',
  '  faceAuditCli handoff [review-artifact.json]...',
  '  faceAuditCli verify-handoff <handoff-artifact.json>',
  '  faceAuditCli handoff-response <handoff-artifact.json> [area-review-artifact.json]...',
  '  faceAuditCli validate <review-artifact.json>',
  '  faceAuditCli ready <review-artifact.json>',
  '  faceAuditCli lock-preview <review-artifact.json>',
  '  faceAuditCli lock-artifact <review-artifact.json>',
  '  faceAuditCli verify-lock-artifact <lock-artifact.json>',
  '  faceAuditCli release-gate [lock-artifact.json]',
  '  faceAuditCli hash-source <evidence-file>...',
  '  faceAuditCli source-template <source-type> <evidence-file>...',
  '  faceAuditCli source-ids-by-area-template <source-artifact.json> <default-source-id> [area=source-id]...',
  '  faceAuditCli evidence-ref-template <source-id> <area> [area|items]',
  '  faceAuditCli area-match-template <area> <source-artifact.json> <source-id> <reviewer> <reviewed-at> [area|items]',
  '  faceAuditCli review-match-template <source-artifact.json> <source-id> <reviewer> <reviewed-at> [area|items]',
  '  faceAuditCli review-match-template-by-area <source-artifact.json> <source-ids-by-area.json> <reviewer> <reviewed-at> [area|items]',
  '',
  'Commands:',
  '  checklist  Print the versioned face-audit checklist JSON.',
  '  template   Print a fillable face-audit review template JSON.',
  '  area-template  Print a fillable review template for one face-audit area.',
  '  template-with-sources  Print a fillable review template with evidenceSources copied from an artifact.',
  '  area-template-with-sources  Print a fillable area review template with evidenceSources copied from an artifact.',
  '  merge      Merge full or area review artifacts into one full review artifact.',
  '  status     Summarize review coverage from full or area review artifacts, or from the empty current checklist.',
  '  todo       Print a compact per-area todo handoff from full or area review artifacts; use --summary for counts only, optionally narrowed to one area.',
  '  review-plan  Print every unfinished face-audit item grouped by area for reviewer assignment.',
  '  review-sheet  Print every face-audit item as TSV for spreadsheet-based review tracking.',
  '  area-review-sheet  Print one face-audit area as TSV for spreadsheet-based review tracking.',
  '  apply-review-sheet  Apply an edited TSV review sheet to baseline review artifacts and print full review JSON.',
  '  reviewer-instructions  Print reviewer handoff instructions markdown from full or area review artifacts.',
  '  area-reviewer-instructions  Print one area-specific reviewer instructions markdown file.',
  '  ci-artifacts  Write CI-friendly status, merged review, review sheets, reviewer handoff, reviewer instructions, and area review artifacts/instructions.',
  '  verify-ci-artifacts  Verify a CI artifact directory has complete, internally consistent face-audit files.',
  '  ci-artifacts-self-check  Generate CI artifacts in a temporary directory, verify them, and clean them up.',
  '  handoff    Print todo plus current per-area review artifacts for unfinished face-audit areas.',
  '  verify-handoff  Verify a reviewer handoff artifact against the current checklist.',
  '  handoff-response  Summarize area artifacts returned for a reviewer handoff.',
  '  validate   Validate a filled review artifact against the current checklist.',
  '  ready      Require a filled review artifact to be ready_to_lock.',
  '  lock-preview  Print audit-status lock preview after the ready gate passes.',
  '  lock-artifact  Print a compact lock-evidence artifact after the ready gate passes.',
  '  verify-lock-artifact  Verify compact lock evidence against the current checklist.',
  '  release-gate  Require evidence if face-audit static data has been locked.',
  '  hash-source  Print sha256 contentHash entries for local official-component evidence files.',
  '  source-template  Print complete evidenceSources entries for hashed official-component files.',
  '  source-ids-by-area-template  Print a full area-to-source-id map for review-match-template-by-area.',
  '  evidence-ref-template  Print area-level or item-specific official-component evidenceRef values.',
  '  area-match-template  Print a filled area review artifact after a human reviewer confirms every area item matches.',
  '  review-match-template  Print a filled full review artifact after a human reviewer confirms every checklist item matches.',
  '  review-match-template-by-area  Print a filled full review artifact using a different source id per face-audit area.',
  '',
  'Reviewed items must cite refs backed by evidenceSources: official-component:<source>#<area>[:<item-id>].',
].join('\n');

const defaultIO: FaceAuditCliIO = {
  makeDirectory: (dirPath) => fs.mkdir(dirPath, {recursive: true}).then(() => undefined),
  makeTempDirectory: (prefix) => fs.mkdtemp(path.join(os.tmpdir(), prefix)),
  removeDirectory: (dirPath) => fs.rm(dirPath, {recursive: true, force: true}),
  readBinaryFile: (filePath) => fs.readFile(filePath),
  readTextFile: (filePath) => fs.readFile(filePath, 'utf8'),
  writeTextFile: (filePath, text) => fs.writeFile(filePath, text, 'utf8'),
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
};

function writeJson(io: FaceAuditCliIO, value: unknown): void {
  io.writeStdout(`${JSON.stringify(value, null, 2)}\n`);
}

function writeError(io: FaceAuditCliIO, message: string): number {
  io.writeStderr(`${message}\n`);
  return 2;
}

type FaceAuditCiArtifactVerificationIssue = {
  field: string;
  message: string;
};

type FaceAuditCiArtifactFileSummary = {
  path: string;
  artifactType: string;
  ok: boolean;
  contentHash?: string;
};

const FACE_AUDIT_CI_MANIFEST_FILE_NAME = 'face-audit-ci-manifest.json';
const FACE_AUDIT_REVIEW_FILE_NAME = 'face-audit-review.json';
const FACE_AUDIT_REVIEW_SHEET_FILE_NAME = 'face-audit-review-sheet.tsv';
const FACE_AUDIT_REVIEW_SHEET_HEADER =
  'area\titemId\titemKey\tlabel\texpectedFields\treviewStatus\tnextStep\treviewer\treviewedAt\tevidenceRef\tnotes';

function issue(field: string, message: string): FaceAuditCiArtifactVerificationIssue {
  return {field, message};
}

async function readReviewArtifacts(
  artifactPaths: readonly string[],
  io: FaceAuditCliIO,
): Promise<{ok: true; artifacts: unknown[]} | {ok: false; error: string}> {
  const artifacts: unknown[] = [];
  for (const artifactPath of artifactPaths) {
    try {
      artifacts.push(await readReviewArtifactJson(artifactPath, io));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {ok: false, error: `Could not read a valid review artifact JSON file: ${detail}`};
    }
  }
  return {ok: true, artifacts};
}

async function writeFaceAuditCliArtifact(
  outputDirectory: string,
  fileName: string,
  value: unknown,
  io: FaceAuditCliIO,
  artifactTypeOverride?: string,
): Promise<FaceAuditCiArtifactFileSummary> {
  if (!io.writeTextFile) {
    throw new Error('Writable file output is not available');
  }
  const filePath = path.join(outputDirectory, fileName);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await io.writeTextFile(filePath, text);
  return {
    path: filePath,
    artifactType: artifactTypeOverride ??
      (isRecord(value) && typeof value.artifactType === 'string' ? value.artifactType : 'unknown'),
    ok: true,
    contentHash: sha256TextContentHash(text),
  };
}

async function writeFaceAuditCliTextArtifact(
  outputDirectory: string,
  fileName: string,
  text: string,
  artifactType: string,
  io: FaceAuditCliIO,
): Promise<FaceAuditCiArtifactFileSummary> {
  if (!io.writeTextFile) {
    throw new Error('Writable file output is not available');
  }
  const filePath = path.join(outputDirectory, fileName);
  const normalizedText = text.endsWith('\n') ? text : `${text}\n`;
  await io.writeTextFile(filePath, normalizedText);
  return {
    path: filePath,
    artifactType,
    ok: true,
    contentHash: sha256TextContentHash(normalizedText),
  };
}

function buildFaceAuditCiArtifactsManifest(options: {
  artifactCount: number;
  outputDirectory: string;
  status: ReturnType<typeof summarizeFaceAuditReviewStatus>;
  reviewOk: boolean;
  todo: ReturnType<typeof buildFaceAuditReviewTodo>;
  plan: ReturnType<typeof buildFaceAuditReviewPlan>;
  reviewSheetOk: boolean;
  reviewSheetRowCount: number;
  handoff: ReturnType<typeof buildFaceAuditReviewerHandoff>;
  files: FaceAuditCiArtifactFileSummary[];
}) {
  return {
    artifactType: 'face_audit_ci_artifacts',
    version: 1,
    ok: options.status.ok && options.reviewOk && options.todo.ok && options.plan.ok && options.reviewSheetOk && options.handoff.ok,
    artifactCount: options.artifactCount,
    outputDirectory: options.outputDirectory,
    summary: {
      checklistFingerprint: options.status.checklistFingerprint,
      reviewFingerprint: options.status.reviewFingerprint,
      checklistItemCount: options.status.checklistItemCount,
      reviewedItemCount: options.status.completion.reviewedItemCount,
      unreviewedItemCount: options.status.completion.unreviewedItemCount,
      pendingAreaCount: options.todo.pendingAreaCount,
      readyAreaCount: options.todo.readyAreaCount,
      pendingItemCount: options.plan.pendingItemCount,
      reviewSheetRowCount: options.reviewSheetRowCount,
      evidenceSourceCount: options.handoff.evidenceSourceCount,
      areaArtifactCount: options.handoff.areas.length,
      areaTodoSummaryArtifactCount: options.handoff.areas.length,
      areaReviewSheetArtifactCount: options.handoff.areas.length,
      areaReviewerInstructionsArtifactCount: options.handoff.areas.length,
      unfinishedAreas: options.plan.areas.map((area) => ({
        area: area.area,
        remainingItemCount: area.remainingItemCount,
        nextStep: area.nextStep,
      })),
    },
    files: options.files,
  };
}

async function writeFaceAuditCiArtifacts(
  outputDirectory: string,
  artifacts: readonly unknown[],
  io: FaceAuditCliIO,
) {
  if (!io.makeDirectory || !io.writeTextFile) {
    throw new Error('Writable file output is not available');
  }

  const status = summarizeFaceAuditReviewStatus(artifacts);
  const mergedReview = mergeFaceAuditReviewArtifacts(artifacts);
  const todo = buildFaceAuditReviewTodo(artifacts);
  const plan = buildFaceAuditReviewPlan(artifacts);
  const handoff = buildFaceAuditReviewerHandoff(artifacts);
  const reviewSheet = buildFaceAuditReviewSheet(artifacts);
  await io.makeDirectory(outputDirectory);
  const files: FaceAuditCiArtifactFileSummary[] = [
    {
      ...(await writeFaceAuditCliArtifact(outputDirectory, 'face-audit-review-status.json', status, io)),
      ok: status.ok,
    },
    {
      ...(await writeFaceAuditCliArtifact(
        outputDirectory,
        FACE_AUDIT_REVIEW_FILE_NAME,
        mergedReview.review,
        io,
        'face_audit_review',
      )),
      ok: mergedReview.ok,
    },
    {
      ...(await writeFaceAuditCliArtifact(outputDirectory, 'face-audit-review-todo.json', todo, io)),
      ok: todo.ok,
    },
    {
      ...(await writeFaceAuditCliArtifact(outputDirectory, 'face-audit-review-plan.json', plan, io)),
      ok: plan.ok,
    },
    {
      ...(await writeFaceAuditCliArtifact(outputDirectory, 'face-audit-reviewer-handoff.json', handoff, io)),
      ok: handoff.ok,
    },
    {
      ...(await writeFaceAuditCliTextArtifact(
        outputDirectory,
        FACE_AUDIT_REVIEW_SHEET_FILE_NAME,
        reviewSheet.tsv,
        'face_audit_review_sheet_tsv',
        io,
      )),
      ok: reviewSheet.ok,
    },
  ];

  const areaFiles: FaceAuditReviewerInstructionAreaFile[] = [];
  for (const area of handoff.areas) {
    const areaFileName = faceAuditAreaReviewArtifactFileName(area.area);
    const areaTodoSummaryFileName = faceAuditAreaReviewTodoSummaryArtifactFileName(area.area);
    const areaReviewSheetFileName = faceAuditAreaReviewSheetArtifactFileName(area.area);
    const areaReviewerInstructionsFileName = faceAuditAreaReviewerInstructionsArtifactFileName(area.area);
    areaFiles.push({
      area: area.area,
      fileName: areaFileName,
      todoSummaryFileName: areaTodoSummaryFileName,
      reviewSheetFileName: areaReviewSheetFileName,
      reviewerInstructionsFileName: areaReviewerInstructionsFileName,
    });
    files.push(await writeFaceAuditCliArtifact(outputDirectory, areaFileName, area.reviewArtifact, io));
    files.push(await writeFaceAuditCliArtifact(
      outputDirectory,
      areaTodoSummaryFileName,
      buildFaceAuditCiAreaTodoSummaryFromHandoff(handoff, area.area),
      io,
    ));
    const areaReviewSheet = buildFaceAuditAreaReviewSheet([area.reviewArtifact], area.area);
    files.push({
      ...(await writeFaceAuditCliTextArtifact(
        outputDirectory,
        areaReviewSheetFileName,
        areaReviewSheet.tsv,
        'face_audit_area_review_sheet_tsv',
        io,
      )),
      ok: areaReviewSheet.ok,
    });
    files.push(await writeFaceAuditCliTextArtifact(
      outputDirectory,
      areaReviewerInstructionsFileName,
      buildFaceAuditAreaReviewerInstructions({
        handoff,
        area,
        reviewFileName: areaFileName,
        todoSummaryFileName: areaTodoSummaryFileName,
        reviewSheetFileName: areaReviewSheetFileName,
      }),
      'face_audit_area_reviewer_instructions',
      io,
    ));
  }

  const instructionsFileName = 'face-audit-reviewer-instructions.md';
  files.push(await writeFaceAuditCliTextArtifact(
    outputDirectory,
    instructionsFileName,
    buildFaceAuditReviewerInstructions({status, todo, plan, handoff, areaFiles}),
    'face_audit_reviewer_instructions',
    io,
  ));

  const manifest = buildFaceAuditCiArtifactsManifest({
    artifactCount: artifacts.length,
    outputDirectory,
    status,
    reviewOk: mergedReview.ok,
    todo,
    plan,
    reviewSheetOk: reviewSheet.ok,
    reviewSheetRowCount: reviewSheet.rowCount,
    handoff,
    files,
  });
  await writeFaceAuditCliArtifact(outputDirectory, FACE_AUDIT_CI_MANIFEST_FILE_NAME, manifest, io);
  return manifest;
}

function buildFaceAuditReviewerInstructionsForArtifacts(artifacts: readonly unknown[]): string {
  const status = summarizeFaceAuditReviewStatus(artifacts);
  const todo = buildFaceAuditReviewTodo(artifacts);
  const plan = buildFaceAuditReviewPlan(artifacts);
  const handoff = buildFaceAuditReviewerHandoff(artifacts);
  const areaFiles = handoff.areas.map((area) => ({
    area: area.area,
    fileName: faceAuditAreaReviewArtifactFileName(area.area),
    todoSummaryFileName: faceAuditAreaReviewTodoSummaryArtifactFileName(area.area),
    reviewSheetFileName: faceAuditAreaReviewSheetArtifactFileName(area.area),
    reviewerInstructionsFileName: faceAuditAreaReviewerInstructionsArtifactFileName(area.area),
  }));
  return buildFaceAuditReviewerInstructions({status, todo, plan, handoff, areaFiles});
}

function buildFaceAuditCiStatusSummaryFromHandoff(handoff: FaceAuditReviewerHandoffReport) {
  return {
    artifactType: 'face_audit_review_status',
    version: 1,
    ok: handoff.ok,
    artifactCount: handoff.artifactCount,
    checklistFingerprint: handoff.checklistFingerprint,
    reviewFingerprint: handoff.reviewFingerprint,
    checklistItemCount: handoff.checklistItemCount,
    completion: handoff.completion,
    issueCount: handoff.issueCount,
    issues: handoff.issues,
  };
}

function faceAuditCiStatusSummary(artifact: unknown) {
  if (!isRecord(artifact)) {
    return undefined;
  }

  return {
    artifactType: artifact.artifactType,
    version: artifact.version,
    ok: artifact.ok,
    artifactCount: artifact.artifactCount,
    checklistFingerprint: artifact.checklistFingerprint,
    reviewFingerprint: artifact.reviewFingerprint,
    checklistItemCount: artifact.checklistItemCount,
    completion: artifact.completion,
    issueCount: artifact.issueCount,
    issues: artifact.issues,
  };
}

function faceAuditCiPlanItemNextStep(item: {reviewStatus: string}) {
  if (item.reviewStatus === 'differs_from_official_face') {
    return 'resolve_differences';
  }
  if (item.reviewStatus === 'needs_better_reference') {
    return 'find_better_reference';
  }
  return 'review_unreviewed_items';
}

function buildFaceAuditCiReviewPlanFromHandoff(handoff: FaceAuditReviewerHandoffReport) {
  const areas = handoff.areas.map((areaHandoff) => {
    const items = areaHandoff.reviewArtifact.items
      .filter((item) => item.reviewStatus !== 'matches_official_face')
      .map((item) => ({
        key: item.key,
        id: item.id,
        label: item.label,
        expectedFields: [...item.expectedFields],
        reviewStatus: item.reviewStatus,
        nextStep: faceAuditCiPlanItemNextStep(item),
        evidenceRef: item.evidenceRef,
        notes: item.notes,
      }));

    return {
      ...areaHandoff.todo,
      evidenceSourceIds: [...areaHandoff.todo.evidenceSourceIds],
      nextItemKeys: [...areaHandoff.todo.nextItemKeys],
      commands: {...areaHandoff.todo.commands},
      items,
    };
  });

  return {
    artifactType: 'face_audit_review_plan',
    version: 1,
    ok: handoff.ok,
    artifactCount: handoff.artifactCount,
    checklistFingerprint: handoff.checklistFingerprint,
    reviewFingerprint: handoff.reviewFingerprint,
    checklistItemCount: handoff.checklistItemCount,
    completion: {...handoff.completion},
    pendingAreaCount: handoff.pendingAreaCount,
    readyAreaCount: handoff.readyAreaCount,
    pendingItemCount: areas.reduce((total, area) => total + area.items.length, 0),
    issueCount: handoff.issueCount,
    commands: {...handoff.todo.commands},
    areas,
    issues: handoff.issues.map((handoffIssue) => ({...handoffIssue})),
  };
}

function buildFaceAuditCiAreaTodoSummaryFromHandoff(
  handoff: FaceAuditReviewerHandoffReport,
  area: string,
) {
  const areaHandoff = handoff.areas.find((candidate) => candidate.area === area);
  if (areaHandoff === undefined) {
    throw new Error(`Missing face-audit handoff area ${area}`);
  }
  const todo = areaHandoff.todo;
  return {
    artifactType: 'face_audit_area_review_todo_summary',
    version: 1,
    ok: handoff.ok,
    artifactCount: handoff.artifactCount,
    area: todo.area,
    status: todo.status,
    checklistFingerprint: handoff.checklistFingerprint,
    reviewFingerprint: handoff.reviewFingerprint,
    checklistItemCount: handoff.checklistItemCount,
    itemCount: todo.itemCount,
    completionStatus: todo.completionStatus,
    nextStep: todo.nextStep,
    pendingItemCount: todo.remainingItemCount,
    remainingItemCount: todo.remainingItemCount,
    reviewedItemCount: todo.reviewedItemCount,
    matchingItemCount: todo.matchingItemCount,
    differenceItemCount: todo.differenceItemCount,
    needsReferenceItemCount: todo.needsReferenceItemCount,
    unreviewedItemCount: todo.unreviewedItemCount,
    evidenceRefCount: todo.evidenceRefCount,
    areaLevelEvidenceRefCount: todo.areaLevelEvidenceRefCount,
    itemSpecificEvidenceRefCount: todo.itemSpecificEvidenceRefCount,
    itemSpecificEvidenceItemCount: todo.itemSpecificEvidenceItemCount,
    evidenceSourceIds: [...todo.evidenceSourceIds],
    issueCount: handoff.issueCount,
    issues: handoff.issues.map((handoffIssue) => ({...handoffIssue})),
  };
}

function buildFaceAuditCiAreaReviewerInstructionsFromHandoff(
  handoff: FaceAuditReviewerHandoffReport,
  area: string,
): string {
  const areaHandoff = handoff.areas.find((candidate) => candidate.area === area);
  if (areaHandoff === undefined) {
    throw new Error(`Missing face-audit handoff area ${area}`);
  }
  return buildFaceAuditAreaReviewerInstructions({
    handoff,
    area: areaHandoff,
    reviewFileName: faceAuditAreaReviewArtifactFileName(areaHandoff.area),
    todoSummaryFileName: faceAuditAreaReviewTodoSummaryArtifactFileName(areaHandoff.area),
    reviewSheetFileName: faceAuditAreaReviewSheetArtifactFileName(areaHandoff.area),
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function readCiArtifactText(
  outputDirectory: string,
  fileName: string,
  io: FaceAuditCliIO,
  issues: FaceAuditCiArtifactVerificationIssue[],
): Promise<string | undefined> {
  const filePath = path.join(outputDirectory, fileName);
  try {
    return await io.readTextFile(filePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    issues.push(issue(fileName, `Could not read CI artifact file ${fileName}: ${detail}`));
    return undefined;
  }
}

async function readCiArtifactJson(
  outputDirectory: string,
  fileName: string,
  expectedArtifactType: string,
  io: FaceAuditCliIO,
  issues: FaceAuditCiArtifactVerificationIssue[],
): Promise<{path: string; artifactType: string; ok: boolean; contentHash?: string; artifact?: unknown}> {
  const filePath = path.join(outputDirectory, fileName);
  const text = await readCiArtifactText(outputDirectory, fileName, io, issues);
  if (text === undefined) {
    return {path: filePath, artifactType: expectedArtifactType, ok: false};
  }
  const contentHash = sha256TextContentHash(text);
  try {
    const artifact = JSON.parse(text) as unknown;
    const artifactType = isRecord(artifact) && typeof artifact.artifactType === 'string'
      ? artifact.artifactType
      : 'unknown';
    if (artifactType !== expectedArtifactType) {
      issues.push(issue(fileName, `CI artifact file ${fileName} must have artifactType ${expectedArtifactType}`));
    }
    return {
      path: filePath,
      artifactType,
      ok: artifactType === expectedArtifactType,
      contentHash,
      artifact,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    issues.push(issue(fileName, `Could not parse CI artifact file ${fileName} as JSON: ${detail}`));
    return {path: filePath, artifactType: expectedArtifactType, ok: false, contentHash};
  }
}

async function readCiReviewArtifact(
  outputDirectory: string,
  fileName: string,
  io: FaceAuditCliIO,
  issues: FaceAuditCiArtifactVerificationIssue[],
): Promise<{path: string; artifactType: string; ok: boolean; contentHash?: string; artifact?: unknown}> {
  const filePath = path.join(outputDirectory, fileName);
  const text = await readCiArtifactText(outputDirectory, fileName, io, issues);
  if (text === undefined) {
    return {path: filePath, artifactType: 'face_audit_review', ok: false};
  }
  const contentHash = sha256TextContentHash(text);
  try {
    const artifact = JSON.parse(text) as unknown;
    const validation = validateFaceAuditReviewArtifact(artifact);
    if (!validation.ok) {
      issues.push(...validation.issues.map((validationIssue) =>
        issue(`${fileName}:${validationIssue.field}`, validationIssue.message),
      ));
    }
    return {
      path: filePath,
      artifactType: 'face_audit_review',
      ok: validation.ok,
      contentHash,
      artifact: validation.review,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    issues.push(issue(fileName, `Could not parse CI artifact file ${fileName} as JSON: ${detail}`));
    return {path: filePath, artifactType: 'face_audit_review', ok: false, contentHash};
  }
}

function ciArtifactFileSummary(file: {path: string; artifactType: string; ok: boolean; contentHash?: string}): FaceAuditCiArtifactFileSummary {
  return {
    path: file.path,
    artifactType: file.artifactType,
    ok: file.ok,
    ...(file.contentHash === undefined ? {} : {contentHash: file.contentHash}),
  };
}

function faceAuditReviewSheetLineCount(text: string): number {
  return text.trimEnd().split('\n').length;
}

function validateFaceAuditCiReviewSheetText(
  text: string | undefined,
  expectedRowCount: number | undefined,
): boolean {
  if (text === undefined) {
    return false;
  }
  const lines = text.trimEnd().split('\n');
  return lines[0] === FACE_AUDIT_REVIEW_SHEET_HEADER &&
    (expectedRowCount === undefined || lines.length === expectedRowCount + 1);
}

async function verifyFaceAuditCiArtifacts(
  outputDirectory: string,
  io: FaceAuditCliIO,
) {
  const issues: FaceAuditCiArtifactVerificationIssue[] = [];
  const files: FaceAuditCiArtifactFileSummary[] = [];
  const contentFiles: FaceAuditCiArtifactFileSummary[] = [];
  const manifestFile = await readCiArtifactJson(
    outputDirectory,
    FACE_AUDIT_CI_MANIFEST_FILE_NAME,
    'face_audit_ci_artifacts',
    io,
    issues,
  );
  const statusFile = await readCiArtifactJson(outputDirectory, 'face-audit-review-status.json', 'face_audit_review_status', io, issues);
  const reviewFile = await readCiReviewArtifact(outputDirectory, FACE_AUDIT_REVIEW_FILE_NAME, io, issues);
  const todoFile = await readCiArtifactJson(outputDirectory, 'face-audit-review-todo.json', 'face_audit_review_todo', io, issues);
  const planFile = await readCiArtifactJson(outputDirectory, 'face-audit-review-plan.json', 'face_audit_review_plan', io, issues);
  const handoffFile = await readCiArtifactJson(outputDirectory, 'face-audit-reviewer-handoff.json', 'face_audit_reviewer_handoff', io, issues);
  const reviewSheetPath = path.join(outputDirectory, FACE_AUDIT_REVIEW_SHEET_FILE_NAME);
  const reviewSheetText = await readCiArtifactText(outputDirectory, FACE_AUDIT_REVIEW_SHEET_FILE_NAME, io, issues);
  files.push(ciArtifactFileSummary(manifestFile));
  contentFiles.push(
    ciArtifactFileSummary(statusFile),
    ciArtifactFileSummary(reviewFile),
    ciArtifactFileSummary(todoFile),
    ciArtifactFileSummary(planFile),
    ciArtifactFileSummary(handoffFile),
  );
  files.push(
    ...contentFiles,
  );

  const handoffValidation = validateFaceAuditReviewerHandoffArtifact(handoffFile.artifact);
  if (!handoffValidation.ok) {
    issues.push(...handoffValidation.issues.map((validationIssue) =>
      issue(`face-audit-reviewer-handoff.json:${validationIssue.field}`, validationIssue.message),
    ));
  }

  const handoff = handoffValidation.handoff;
  const expectedReviewSheet = reviewFile.artifact === undefined
    ? undefined
    : buildFaceAuditReviewSheet([reviewFile.artifact]);
  const reviewSheetHasValidShape = validateFaceAuditCiReviewSheetText(
    reviewSheetText,
    expectedReviewSheet?.rowCount ?? handoff?.checklistItemCount,
  );
  const reviewSheetMatchesReview = reviewSheetText !== undefined &&
    expectedReviewSheet !== undefined &&
    reviewSheetText === expectedReviewSheet.tsv;
  const reviewSheetImport = reviewSheetText !== undefined && reviewFile.artifact !== undefined
    ? applyFaceAuditReviewSheet([reviewFile.artifact], reviewSheetText)
    : undefined;
  const reviewSheetImportsReview = reviewSheetMatchesReview &&
    reviewSheetImport !== undefined &&
    reviewSheetImport.ok &&
    reviewFile.artifact !== undefined &&
    canonicalJson(reviewSheetImport.review) === canonicalJson(reviewFile.artifact);
  const reviewSheetOk = reviewSheetHasValidShape && reviewSheetMatchesReview && reviewSheetImportsReview;
  if (!reviewSheetHasValidShape) {
    issues.push(issue(
      FACE_AUDIT_REVIEW_SHEET_FILE_NAME,
      'CI review sheet must include the TSV header and one row per checklist item',
    ));
  }
  if (reviewSheetHasValidShape && !reviewSheetMatchesReview) {
    issues.push(issue(
      FACE_AUDIT_REVIEW_SHEET_FILE_NAME,
      `CI review sheet artifact file ${FACE_AUDIT_REVIEW_SHEET_FILE_NAME} does not match ${FACE_AUDIT_REVIEW_FILE_NAME}`,
    ));
  }
  if (reviewSheetHasValidShape && reviewSheetMatchesReview && !reviewSheetImportsReview) {
    issues.push(issue(
      FACE_AUDIT_REVIEW_SHEET_FILE_NAME,
      `CI review sheet artifact file ${FACE_AUDIT_REVIEW_SHEET_FILE_NAME} cannot be applied back to ${FACE_AUDIT_REVIEW_FILE_NAME}`,
    ));
  }
  const reviewSheetFileSummary = {
    path: reviewSheetPath,
    artifactType: 'face_audit_review_sheet_tsv',
    ok: reviewSheetOk,
    ...(reviewSheetText === undefined ? {} : {contentHash: sha256TextContentHash(reviewSheetText)}),
  };
  contentFiles.push(reviewSheetFileSummary);
  files.push(reviewSheetFileSummary);
  if (
    handoff &&
    statusFile.artifact !== undefined &&
    todoFile.artifact !== undefined &&
    planFile.artifact !== undefined
  ) {
    if (
      reviewFile.artifact !== undefined &&
      (() => {
        const handoffFromReview = buildFaceAuditReviewerHandoff([reviewFile.artifact]);
        return canonicalJson(handoff) !== canonicalJson({
          ...handoffFromReview,
          artifactCount: handoff.artifactCount,
          todo: {
            ...handoffFromReview.todo,
            artifactCount: handoff.todo.artifactCount,
          },
        });
      })()
    ) {
      issues.push(issue(
        FACE_AUDIT_REVIEW_FILE_NAME,
        `CI full review artifact file ${FACE_AUDIT_REVIEW_FILE_NAME} does not match the reviewer handoff`,
      ));
    }
    if (
      canonicalJson(faceAuditCiStatusSummary(statusFile.artifact)) !==
      canonicalJson(buildFaceAuditCiStatusSummaryFromHandoff(handoff))
    ) {
      issues.push(issue(
        'face-audit-review-status.json',
        'CI status artifact file face-audit-review-status.json summary does not match the reviewer handoff',
      ));
    }
    if (canonicalJson(todoFile.artifact) !== canonicalJson(handoff.todo)) {
      issues.push(issue(
        'face-audit-review-todo.json',
        'CI todo artifact file face-audit-review-todo.json does not match the reviewer handoff embedded todo',
      ));
    }
    if (canonicalJson(planFile.artifact) !== canonicalJson(buildFaceAuditCiReviewPlanFromHandoff(handoff))) {
      issues.push(issue(
        'face-audit-review-plan.json',
        'CI review-plan artifact file face-audit-review-plan.json does not match the reviewer handoff embedded area artifacts',
      ));
    }

    for (const area of handoff.areas) {
      const fileName = faceAuditAreaReviewArtifactFileName(area.area);
      const areaFile = await readCiArtifactJson(outputDirectory, fileName, 'face_audit_area_review', io, issues);
      const areaFileSummary = ciArtifactFileSummary(areaFile);
      contentFiles.push(areaFileSummary);
      files.push(areaFileSummary);
      const areaTodoSummaryFileName = faceAuditAreaReviewTodoSummaryArtifactFileName(area.area);
      const areaTodoSummaryFile = await readCiArtifactJson(
        outputDirectory,
        areaTodoSummaryFileName,
        'face_audit_area_review_todo_summary',
        io,
        issues,
      );
      const areaTodoSummaryFileSummary = ciArtifactFileSummary(areaTodoSummaryFile);
      contentFiles.push(areaTodoSummaryFileSummary);
      files.push(areaTodoSummaryFileSummary);
      const parsedArea = parseFaceAuditArea(area.area);
      const areaValidation = parsedArea === undefined
        ? undefined
        : validateFaceAuditAreaReviewArtifact(areaFile.artifact, parsedArea);
      if (areaValidation !== undefined && !areaValidation.ok) {
        issues.push(...areaValidation.issues.map((validationIssue) =>
          issue(`${fileName}:${validationIssue.field}`, validationIssue.message),
        ));
      }
      if (
        areaFile.artifact !== undefined &&
        canonicalJson(areaFile.artifact) !== canonicalJson(area.reviewArtifact)
      ) {
        issues.push(issue(fileName, `CI area artifact file ${fileName} does not match the reviewer handoff embedded area artifact`));
      }
      if (
        areaTodoSummaryFile.artifact !== undefined &&
        canonicalJson(areaTodoSummaryFile.artifact) !== canonicalJson(buildFaceAuditCiAreaTodoSummaryFromHandoff(handoff, area.area))
      ) {
        issues.push(issue(
          areaTodoSummaryFileName,
          `CI area todo summary artifact file ${areaTodoSummaryFileName} does not match the reviewer handoff embedded todo area`,
        ));
      }

      const areaReviewSheetFileName = faceAuditAreaReviewSheetArtifactFileName(area.area);
      const areaReviewSheetPath = path.join(outputDirectory, areaReviewSheetFileName);
      const areaReviewSheetText = await readCiArtifactText(
        outputDirectory,
        areaReviewSheetFileName,
        io,
        issues,
      );
      const expectedAreaReviewSheet = parsedArea === undefined || areaFile.artifact === undefined
        ? undefined
        : buildFaceAuditAreaReviewSheet([areaFile.artifact], parsedArea);
      const areaReviewSheetHasValidShape = validateFaceAuditCiReviewSheetText(
        areaReviewSheetText,
        expectedAreaReviewSheet?.rowCount ?? area.todo.itemCount,
      );
      const areaReviewSheetMatchesAreaReview =
        areaReviewSheetText !== undefined &&
        expectedAreaReviewSheet !== undefined &&
        areaReviewSheetText === expectedAreaReviewSheet.tsv;
      const areaReviewSheetOk = areaReviewSheetHasValidShape && areaReviewSheetMatchesAreaReview;
      if (!areaReviewSheetHasValidShape) {
        issues.push(issue(
          areaReviewSheetFileName,
          `CI area review sheet ${areaReviewSheetFileName} must include the TSV header and one row per area item`,
        ));
      }
      if (areaReviewSheetHasValidShape && !areaReviewSheetMatchesAreaReview) {
        issues.push(issue(
          areaReviewSheetFileName,
          `CI area review sheet artifact file ${areaReviewSheetFileName} does not match ${fileName}`,
        ));
      }
      const areaReviewSheetFileSummary = {
        path: areaReviewSheetPath,
        artifactType: 'face_audit_area_review_sheet_tsv',
        ok: areaReviewSheetOk,
        ...(areaReviewSheetText === undefined ? {} : {contentHash: sha256TextContentHash(areaReviewSheetText)}),
      };
      contentFiles.push(areaReviewSheetFileSummary);
      files.push(areaReviewSheetFileSummary);

      const areaReviewerInstructionsFileName = faceAuditAreaReviewerInstructionsArtifactFileName(area.area);
      const areaReviewerInstructionsPath = path.join(outputDirectory, areaReviewerInstructionsFileName);
      const areaReviewerInstructions = await readCiArtifactText(
        outputDirectory,
        areaReviewerInstructionsFileName,
        io,
        issues,
      );
      const expectedAreaReviewerInstructions =
        `${buildFaceAuditCiAreaReviewerInstructionsFromHandoff(handoff, area.area)}\n`;
      const areaReviewerInstructionsOk =
        areaReviewerInstructions !== undefined &&
        areaReviewerInstructions === expectedAreaReviewerInstructions;
      if (areaReviewerInstructions !== undefined && !areaReviewerInstructionsOk) {
        issues.push(issue(
          areaReviewerInstructionsFileName,
          `CI area reviewer instructions file ${areaReviewerInstructionsFileName} does not match the reviewer handoff embedded todo area`,
        ));
      }
      const areaReviewerInstructionsFileSummary = {
        path: areaReviewerInstructionsPath,
        artifactType: 'face_audit_area_reviewer_instructions',
        ok: areaReviewerInstructionsOk,
        ...(areaReviewerInstructions === undefined ? {} : {contentHash: sha256TextContentHash(areaReviewerInstructions)}),
      };
      contentFiles.push(areaReviewerInstructionsFileSummary);
      files.push(areaReviewerInstructionsFileSummary);
    }
  }

  const instructionsFileName = 'face-audit-reviewer-instructions.md';
  const instructionsPath = path.join(outputDirectory, instructionsFileName);
  const instructions = await readCiArtifactText(outputDirectory, instructionsFileName, io, issues);
  const instructionsOk = instructions !== undefined &&
    instructions.includes('# Face Audit Reviewer Instructions') &&
    (handoff === undefined || instructions.includes(handoff.reviewFingerprint));
  if (!instructionsOk) {
    issues.push(issue(instructionsFileName, 'CI reviewer instructions must include the title and current review fingerprint'));
  }
  const instructionsFileSummary = {
    path: instructionsPath,
    artifactType: 'face_audit_reviewer_instructions',
    ok: instructionsOk,
    ...(instructions === undefined ? {} : {contentHash: sha256TextContentHash(instructions)}),
  };
  contentFiles.push(instructionsFileSummary);
  files.push(instructionsFileSummary);

  if (handoff) {
    const expectedManifest = buildFaceAuditCiArtifactsManifest({
      artifactCount: handoff.artifactCount,
      outputDirectory,
      status: statusFile.artifact as ReturnType<typeof summarizeFaceAuditReviewStatus>,
      reviewOk: reviewFile.ok,
      todo: todoFile.artifact as ReturnType<typeof buildFaceAuditReviewTodo>,
      plan: planFile.artifact as ReturnType<typeof buildFaceAuditReviewPlan>,
      reviewSheetOk,
      reviewSheetRowCount: reviewSheetText === undefined ? 0 : faceAuditReviewSheetLineCount(reviewSheetText) - 1,
      handoff,
      files: contentFiles,
    });
    if (manifestFile.artifact !== undefined && canonicalJson(manifestFile.artifact) !== canonicalJson(expectedManifest)) {
      issues.push(issue(
        FACE_AUDIT_CI_MANIFEST_FILE_NAME,
        `CI manifest file ${FACE_AUDIT_CI_MANIFEST_FILE_NAME} does not match the artifacts in the directory`,
      ));
    }
  }

  return {
    artifactType: 'face_audit_ci_artifacts_verification',
    version: 1,
    ok: issues.length === 0,
    outputDirectory,
    reviewFingerprint: handoff?.reviewFingerprint,
    pendingAreaCount: handoff?.pendingAreaCount ?? 0,
    readyAreaCount: handoff?.readyAreaCount ?? 0,
    fileCount: files.length,
    files,
    issueCount: issues.length,
    issues,
  };
}

async function readReviewArtifactJson(filePath: string, io: FaceAuditCliIO): Promise<unknown> {
  return JSON.parse(await io.readTextFile(filePath)) as unknown;
}

async function readEvidenceSourceBytes(filePath: string, io: FaceAuditCliIO): Promise<Uint8Array> {
  if (io.readBinaryFile) {
    return io.readBinaryFile(filePath);
  }
  return Buffer.from(await io.readTextFile(filePath));
}

function sha256ContentHash(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sha256TextContentHash(text: string): string {
  return sha256ContentHash(Buffer.from(text, 'utf8'));
}

function parseEvidenceSourceType(value: unknown): FaceAuditEvidenceSourceType | undefined {
  return typeof value === 'string' && (FACE_AUDIT_EVIDENCE_SOURCE_TYPES as readonly string[]).includes(value)
    ? value as FaceAuditEvidenceSourceType
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validEvidenceRefSourceId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value);
}

function evidenceSourcesPayload(value: unknown): unknown[] | undefined {
  return isRecord(value) && Array.isArray(value.evidenceSources)
    ? value.evidenceSources
    : undefined;
}

function evidenceSourceId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return undefined;
  }
  const id = value.id.trim();
  return id || undefined;
}

function sourceIdsByAreaTemplateCliError(issue: {field: string; message: string}): string {
  if (issue.field === 'sourceArtifact.evidenceSources') {
    return 'The source-ids-by-area-template command source artifact must include an evidenceSources array.';
  }
  if (issue.field === 'defaultSourceId' && issue.message.includes('must match')) {
    return 'The source-ids-by-area-template command expects a default source id matching the evidenceRef source id format.';
  }
  if (issue.field === 'defaultSourceId') {
    return issue.message.replace(
      'Face-audit source ids by area template default source id is not declared',
      'The source-ids-by-area-template command default source id is not declared',
    );
  }
  if (issue.field === 'sourceIdsByAreaOverrides') {
    return 'The source-ids-by-area-template command overrides must use area=source-id.';
  }
  const overridePrefix = 'sourceIdsByAreaOverrides.';
  if (issue.field.startsWith(overridePrefix)) {
    const area = issue.field.slice(overridePrefix.length);
    if (issue.message.includes('area is not known')) {
      return `Unknown face-audit area in source id override: ${area}`;
    }
    if (issue.message.includes('must match')) {
      return `The source-ids-by-area-template command source id for ${area} must match the evidenceRef source id format.`;
    }
    return issue.message.replace(
      'Face-audit source ids by area template source id',
      'The source-ids-by-area-template command source id',
    );
  }
  return issue.message;
}

function fileNameWithoutFinalExtension(filePath: string): string {
  const base = path.basename(filePath);
  const extension = path.extname(base);
  return extension ? base.slice(0, -extension.length) : base;
}

function sourceIdFromPath(filePath: string, usedIds: Set<string>): string {
  const normalized = fileNameWithoutFinalExtension(filePath)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9._/-]+$/, '');
  const base = normalized || 'evidence-source';
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  usedIds.add(candidate);
  return candidate;
}

function parseTodoCommandArgs(
  args: readonly string[],
): {ok: true; artifactPaths: string[]; summary: boolean; area?: ReturnType<typeof parseFaceAuditArea>} | {ok: false; error: string} {
  const artifactPaths: string[] = [];
  let summary = false;
  let area: ReturnType<typeof parseFaceAuditArea>;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--summary') {
      summary = true;
    } else if (arg === '--area') {
      const areaArg = args[index + 1];
      if (areaArg === undefined || areaArg.startsWith('-')) {
        return {ok: false, error: 'The todo --area option expects one face-audit area.'};
      }
      area = parseFaceAuditArea(areaArg);
      if (!area) {
        return {ok: false, error: `Unknown face-audit area: ${areaArg}`};
      }
      index++;
    } else if (arg.startsWith('--area=')) {
      const areaArg = arg.slice('--area='.length);
      area = parseFaceAuditArea(areaArg);
      if (!area) {
        return {ok: false, error: `Unknown face-audit area: ${areaArg}`};
      }
    } else if (arg.startsWith('-')) {
      return {ok: false, error: `The todo command does not accept option: ${arg}`};
    } else {
      artifactPaths.push(arg);
    }
  }

  if (area !== undefined && !summary) {
    return {ok: false, error: 'The todo --area option requires --summary.'};
  }

  return {ok: true, artifactPaths, summary, area};
}

export async function runFaceAuditCli(
  argv: readonly string[],
  io: FaceAuditCliIO = defaultIO,
): Promise<number> {
  const [command, ...commandArgs] = argv;
  const [filePath, ...extraArgs] = commandArgs;

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    io.writeStdout(`${helpText}\n`);
    return 0;
  }

  if (command === 'checklist') {
    if (filePath !== undefined) {
      return writeError(io, 'The checklist command does not accept file arguments.');
    }
    writeJson(io, buildFaceAuditChecklistExport());
    return 0;
  }

  if (command === 'template') {
    if (filePath !== undefined) {
      return writeError(io, 'The template command does not accept file arguments.');
    }
    writeJson(io, buildFaceAuditReviewTemplate());
    return 0;
  }

  if (command === 'area-template') {
    if (filePath === undefined || extraArgs.length > 0) {
      return writeError(io, 'The area-template command expects exactly one face-audit area.');
    }
    const area = parseFaceAuditArea(filePath);
    if (!area) {
      return writeError(io, `Unknown face-audit area: ${filePath}`);
    }
    writeJson(io, buildFaceAuditAreaReviewTemplate(area));
    return 0;
  }

  if (command === 'template-with-sources') {
    if (filePath === undefined || extraArgs.length > 0) {
      return writeError(io, 'The template-with-sources command expects exactly one source artifact JSON file.');
    }
    let sourceArtifact: unknown;
    try {
      sourceArtifact = await readReviewArtifactJson(filePath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid source artifact JSON file: ${detail}`);
    }
    const evidenceSources = evidenceSourcesPayload(sourceArtifact);
    if (evidenceSources === undefined) {
      return writeError(io, 'The template-with-sources command source artifact must include an evidenceSources array.');
    }
    const template = buildFaceAuditReviewTemplate();
    const validation = validateFaceAuditReviewArtifact({
      ...template,
      evidenceSources,
    });
    writeJson(io, validation.ok ? validation.review : validation);
    return validation.ok ? 0 : 1;
  }

  if (command === 'area-template-with-sources') {
    const areaArg = filePath;
    const sourceArtifactPath = extraArgs[0];
    if (areaArg === undefined || sourceArtifactPath === undefined || extraArgs.length > 1) {
      return writeError(io, 'The area-template-with-sources command expects a face-audit area and one source artifact JSON file.');
    }
    const area = parseFaceAuditArea(areaArg);
    if (area === undefined) {
      return writeError(io, `Unknown face-audit area: ${areaArg}`);
    }
    let sourceArtifact: unknown;
    try {
      sourceArtifact = await readReviewArtifactJson(sourceArtifactPath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid source artifact JSON file: ${detail}`);
    }
    const evidenceSources = evidenceSourcesPayload(sourceArtifact);
    if (evidenceSources === undefined) {
      return writeError(io, 'The area-template-with-sources command source artifact must include an evidenceSources array.');
    }
    const template = buildFaceAuditAreaReviewTemplate(area);
    const validation = validateFaceAuditAreaReviewArtifact({
      ...template,
      evidenceSources,
    }, area);
    writeJson(io, validation.ok ? validation.review : validation);
    return validation.ok ? 0 : 1;
  }

  if (command === 'merge') {
    if (filePath === undefined) {
      return writeError(io, 'The merge command expects at least one review artifact JSON file.');
    }
    const artifactPaths = [filePath, ...extraArgs];
    const artifacts: unknown[] = [];
    for (const artifactPath of artifactPaths) {
      try {
        artifacts.push(await readReviewArtifactJson(artifactPath, io));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return writeError(io, `Could not read a valid review artifact JSON file: ${detail}`);
      }
    }
    const validation = mergeFaceAuditReviewArtifacts(artifacts);
    writeJson(io, validation.ok ? validation.review : validation);
    return validation.ok ? 0 : 1;
  }

  if (command === 'status') {
    const artifactPaths = filePath === undefined ? [] : [filePath, ...extraArgs];
    const artifacts: unknown[] = [];
    for (const artifactPath of artifactPaths) {
      try {
        artifacts.push(await readReviewArtifactJson(artifactPath, io));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return writeError(io, `Could not read a valid review artifact JSON file: ${detail}`);
      }
    }
    const report = summarizeFaceAuditReviewStatus(artifacts);
    writeJson(io, report);
    return report.ok ? 0 : 1;
  }

  if (command === 'todo') {
    const parsedArgs = parseTodoCommandArgs(commandArgs);
    if (!parsedArgs.ok) {
      return writeError(io, parsedArgs.error);
    }
    const artifactResult = await readReviewArtifacts(parsedArgs.artifactPaths, io);
    if (!artifactResult.ok) {
      return writeError(io, artifactResult.error);
    }
    if (parsedArgs.area !== undefined) {
      const areaSummary = buildFaceAuditAreaReviewTodoSummary(artifactResult.artifacts, parsedArgs.area);
      writeJson(io, areaSummary);
      return areaSummary.ok ? 0 : 1;
    }
    const report = buildFaceAuditReviewTodo(artifactResult.artifacts);
    const output = parsedArgs.summary ? buildFaceAuditReviewTodoSummary(report) : report;
    writeJson(io, output);
    return output.ok ? 0 : 1;
  }

  if (command === 'review-plan') {
    const artifactPaths = filePath === undefined ? [] : [filePath, ...extraArgs];
    const artifactResult = await readReviewArtifacts(artifactPaths, io);
    if (!artifactResult.ok) {
      return writeError(io, artifactResult.error);
    }
    const report = buildFaceAuditReviewPlan(artifactResult.artifacts);
    writeJson(io, report);
    return report.ok ? 0 : 1;
  }

  if (command === 'review-sheet') {
    const artifactPaths = filePath === undefined ? [] : [filePath, ...extraArgs];
    const artifactResult = await readReviewArtifacts(artifactPaths, io);
    if (!artifactResult.ok) {
      return writeError(io, artifactResult.error);
    }
    const sheet = buildFaceAuditReviewSheet(artifactResult.artifacts);
    if (!sheet.ok) {
      return writeError(io, `Could not build face-audit review sheet: ${sheet.issues.map((issue) => issue.message).join('; ')}`);
    }
    io.writeStdout(sheet.tsv);
    return 0;
  }

  if (command === 'area-review-sheet') {
    if (filePath === undefined) {
      return writeError(io, 'The area-review-sheet command expects a face-audit area and optional review artifact JSON files.');
    }
    const area = parseFaceAuditArea(filePath);
    if (area === undefined) {
      return writeError(io, `Unknown face-audit area: ${filePath}`);
    }
    const artifactResult = await readReviewArtifacts(extraArgs, io);
    if (!artifactResult.ok) {
      return writeError(io, artifactResult.error);
    }
    const sheet = buildFaceAuditAreaReviewSheet(artifactResult.artifacts, area);
    if (!sheet.ok) {
      return writeError(io, `Could not build face-audit area review sheet: ${sheet.issues.map((issue) => issue.message).join('; ')}`);
    }
    io.writeStdout(sheet.tsv);
    return 0;
  }

  if (command === 'apply-review-sheet') {
    if (filePath === undefined) {
      return writeError(io, 'The apply-review-sheet command expects a review sheet TSV file and optional review artifact JSON files.');
    }
    let reviewSheetTsv: string;
    try {
      reviewSheetTsv = await io.readTextFile(filePath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read face-audit review sheet TSV file: ${detail}`);
    }
    const artifactResult = await readReviewArtifacts(extraArgs, io);
    if (!artifactResult.ok) {
      return writeError(io, artifactResult.error);
    }
    const report = applyFaceAuditReviewSheet(artifactResult.artifacts, reviewSheetTsv);
    writeJson(io, report.ok ? report.review : report);
    return report.ok ? 0 : 1;
  }

  if (command === 'reviewer-instructions') {
    const artifactPaths = filePath === undefined ? [] : [filePath, ...extraArgs];
    const artifactResult = await readReviewArtifacts(artifactPaths, io);
    if (!artifactResult.ok) {
      return writeError(io, artifactResult.error);
    }
    io.writeStdout(`${buildFaceAuditReviewerInstructionsForArtifacts(artifactResult.artifacts)}\n`);
    return 0;
  }

  if (command === 'area-reviewer-instructions') {
    if (filePath === undefined) {
      return writeError(io, 'The area-reviewer-instructions command expects a face-audit area and optional review artifact JSON files.');
    }
    const area = parseFaceAuditArea(filePath);
    if (area === undefined) {
      return writeError(io, `Unknown face-audit area: ${filePath}`);
    }
    const artifactResult = await readReviewArtifacts(extraArgs, io);
    if (!artifactResult.ok) {
      return writeError(io, artifactResult.error);
    }
    const report = buildFaceAuditAreaReviewerInstructionsReport(artifactResult.artifacts, area);
    if (!report.ok) {
      return writeError(io, `Could not build face-audit area reviewer instructions: ${report.issues.map((issue) => issue.message).join('; ')}`);
    }
    io.writeStdout(`${report.markdown}\n`);
    return 0;
  }

  if (command === 'ci-artifacts') {
    const outputDirectory = filePath;
    if (outputDirectory === undefined) {
      return writeError(io, 'The ci-artifacts command expects an output directory and optional review artifact JSON files.');
    }
    if (!io.makeDirectory || !io.writeTextFile) {
      return writeError(io, 'The ci-artifacts command requires writable file output.');
    }

    const artifactResult = await readReviewArtifacts(extraArgs, io);
    if (!artifactResult.ok) {
      return writeError(io, artifactResult.error);
    }

    const manifest = await writeFaceAuditCiArtifacts(outputDirectory, artifactResult.artifacts, io);
    writeJson(io, manifest);
    return manifest.ok ? 0 : 1;
  }

  if (command === 'verify-ci-artifacts') {
    const outputDirectory = filePath;
    if (outputDirectory === undefined || extraArgs.length > 0) {
      return writeError(io, 'The verify-ci-artifacts command expects exactly one output directory.');
    }
    const report = await verifyFaceAuditCiArtifacts(outputDirectory, io);
    writeJson(io, report);
    return report.ok ? 0 : 1;
  }

  if (command === 'ci-artifacts-self-check') {
    if (!io.makeDirectory || !io.makeTempDirectory || !io.removeDirectory || !io.writeTextFile) {
      return writeError(io, 'The ci-artifacts-self-check command requires temporary writable file output.');
    }
    const artifactPaths = filePath === undefined ? [] : [filePath, ...extraArgs];
    const artifactResult = await readReviewArtifacts(artifactPaths, io);
    if (!artifactResult.ok) {
      return writeError(io, artifactResult.error);
    }

    let outputDirectory = '';
    let cleanupIssue: FaceAuditCiArtifactVerificationIssue | undefined;
    let manifest: ReturnType<typeof buildFaceAuditCiArtifactsManifest> | undefined;
    let verification: Awaited<ReturnType<typeof verifyFaceAuditCiArtifacts>> | undefined;
    try {
      outputDirectory = await io.makeTempDirectory('face-audit-ci-artifacts-');
      manifest = await writeFaceAuditCiArtifacts(outputDirectory, artifactResult.artifacts, io);
      verification = await verifyFaceAuditCiArtifacts(outputDirectory, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not self-check face-audit CI artifacts: ${detail}`);
    } finally {
      if (outputDirectory) {
        try {
          await io.removeDirectory(outputDirectory);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          cleanupIssue = issue('cleanup', `Could not clean temporary CI artifact directory: ${detail}`);
        }
      }
    }

    const issues = [
      ...(verification?.issues ?? []),
      ...(cleanupIssue === undefined ? [] : [cleanupIssue]),
    ];
    const report = {
      artifactType: 'face_audit_ci_artifacts_self_check',
      version: 1,
      ok: Boolean(manifest?.ok && verification?.ok && cleanupIssue === undefined),
      artifactCount: artifactResult.artifacts.length,
      outputDirectory,
      cleanedUp: cleanupIssue === undefined,
      reviewFingerprint: verification?.reviewFingerprint,
      pendingAreaCount: verification?.pendingAreaCount ?? 0,
      readyAreaCount: verification?.readyAreaCount ?? 0,
      fileCount: verification?.fileCount ?? 0,
      issueCount: issues.length,
      issues,
    };
    writeJson(io, report);
    return report.ok ? 0 : 1;
  }

  if (command === 'handoff') {
    const artifactPaths = filePath === undefined ? [] : [filePath, ...extraArgs];
    const artifacts: unknown[] = [];
    for (const artifactPath of artifactPaths) {
      try {
        artifacts.push(await readReviewArtifactJson(artifactPath, io));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return writeError(io, `Could not read a valid review artifact JSON file: ${detail}`);
      }
    }
    const report = buildFaceAuditReviewerHandoff(artifacts);
    writeJson(io, report);
    return report.ok ? 0 : 1;
  }

  if (command === 'verify-handoff') {
    if (filePath === undefined || extraArgs.length > 0) {
      return writeError(io, 'The verify-handoff command expects exactly one handoff artifact JSON file.');
    }
    let parsed: unknown;
    try {
      parsed = await readReviewArtifactJson(filePath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid handoff artifact JSON file: ${detail}`);
    }
    const validation = validateFaceAuditReviewerHandoffArtifact(parsed);
    writeJson(io, validation);
    return validation.ok ? 0 : 1;
  }

  if (command === 'handoff-response') {
    if (filePath === undefined) {
      return writeError(io, 'The handoff-response command expects a handoff artifact JSON file and optional area review artifact files.');
    }
    let handoffArtifact: unknown;
    try {
      handoffArtifact = await readReviewArtifactJson(filePath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid handoff artifact JSON file: ${detail}`);
    }
    const artifacts: unknown[] = [];
    for (const artifactPath of extraArgs) {
      try {
        artifacts.push(await readReviewArtifactJson(artifactPath, io));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return writeError(io, `Could not read a valid review artifact JSON file: ${detail}`);
      }
    }
    const report = summarizeFaceAuditReviewerHandoffResponse(handoffArtifact, artifacts);
    writeJson(io, report);
    return report.ok ? 0 : 1;
  }

  if (command === 'validate') {
    if (filePath === undefined || extraArgs.length > 0) {
      return writeError(io, 'The validate command expects exactly one review artifact JSON file.');
    }
    let parsed: unknown;
    try {
      parsed = await readReviewArtifactJson(filePath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid review artifact JSON file: ${detail}`);
    }
    const validation = validateFaceAuditReviewArtifact(parsed);
    writeJson(io, validation);
    return validation.ok ? 0 : 1;
  }

  if (command === 'ready') {
    if (filePath === undefined || extraArgs.length > 0) {
      return writeError(io, 'The ready command expects exactly one review artifact JSON file.');
    }
    let parsed: unknown;
    try {
      parsed = await readReviewArtifactJson(filePath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid review artifact JSON file: ${detail}`);
    }
    const validation = validateFaceAuditReadyArtifact(parsed);
    writeJson(io, validation);
    return validation.ok ? 0 : 1;
  }

  if (command === 'lock-preview') {
    if (filePath === undefined || extraArgs.length > 0) {
      return writeError(io, 'The lock-preview command expects exactly one review artifact JSON file.');
    }
    let parsed: unknown;
    try {
      parsed = await readReviewArtifactJson(filePath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid review artifact JSON file: ${detail}`);
    }
    const preview = buildFaceAuditLockPreview(parsed);
    writeJson(io, preview);
    return preview.ok ? 0 : 1;
  }

  if (command === 'lock-artifact') {
    if (filePath === undefined || extraArgs.length > 0) {
      return writeError(io, 'The lock-artifact command expects exactly one review artifact JSON file.');
    }
    let parsed: unknown;
    try {
      parsed = await readReviewArtifactJson(filePath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid review artifact JSON file: ${detail}`);
    }
    const artifact = buildFaceAuditLockArtifact(parsed);
    writeJson(io, artifact.ok && artifact.lockArtifact ? artifact.lockArtifact : artifact);
    return artifact.ok ? 0 : 1;
  }

  if (command === 'verify-lock-artifact') {
    if (filePath === undefined || extraArgs.length > 0) {
      return writeError(io, 'The verify-lock-artifact command expects exactly one lock artifact JSON file.');
    }
    let parsed: unknown;
    try {
      parsed = await readReviewArtifactJson(filePath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid lock artifact JSON file: ${detail}`);
    }
    const validation = validateFaceAuditLockArtifact(parsed);
    writeJson(io, validation);
    return validation.ok ? 0 : 1;
  }

  if (command === 'hash-source') {
    if (filePath === undefined) {
      return writeError(io, 'The hash-source command expects at least one evidence file path.');
    }
    const sourcePaths = [filePath, ...extraArgs];
    const sources: Array<{locator: string; contentHash: string}> = [];
    for (const sourcePath of sourcePaths) {
      try {
        sources.push({
          locator: sourcePath,
          contentHash: sha256ContentHash(await readEvidenceSourceBytes(sourcePath, io)),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return writeError(io, `Could not read evidence source file: ${detail}`);
      }
    }
    writeJson(io, {
      artifactType: 'face_audit_evidence_source_hashes',
      version: 1,
      algorithm: 'sha256',
      sourceCount: sources.length,
      sources,
    });
    return 0;
  }

  if (command === 'source-template') {
    const sourceType = parseEvidenceSourceType(filePath);
    if (sourceType === undefined) {
      return writeError(
        io,
        'The source-template command expects source type official_physical_component or official_high_res_component_image.',
      );
    }
    if (extraArgs.length === 0) {
      return writeError(io, 'The source-template command expects at least one evidence file path.');
    }
    const usedIds = new Set<string>();
    const evidenceSources = [];
    for (const sourcePath of extraArgs) {
      try {
        evidenceSources.push({
          id: sourceIdFromPath(sourcePath, usedIds),
          label: path.basename(sourcePath),
          sourceType,
          citation: `Official Brass: Birmingham component evidence: ${sourcePath}`,
          locator: sourcePath,
          contentHash: sha256ContentHash(await readEvidenceSourceBytes(sourcePath, io)),
          notes: '',
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return writeError(io, `Could not read evidence source file: ${detail}`);
      }
    }
    writeJson(io, {
      artifactType: 'face_audit_evidence_source_template',
      version: 1,
      sourceType,
      sourceCount: evidenceSources.length,
      evidenceSources,
    });
    return 0;
  }

  if (command === 'source-ids-by-area-template') {
    const sourceArtifactPath = filePath;
    const [defaultSourceIdArg, ...overrideArgs] = extraArgs;
    if (sourceArtifactPath === undefined || defaultSourceIdArg === undefined) {
      return writeError(
        io,
        'The source-ids-by-area-template command expects source artifact JSON file, default source id, and optional area=source-id overrides.',
      );
    }
    const defaultSourceId = defaultSourceIdArg.trim();

    let sourceArtifact: unknown;
    try {
      sourceArtifact = await readReviewArtifactJson(sourceArtifactPath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid source artifact JSON file: ${detail}`);
    }

    const overrides: Record<string, string> = {};
    for (const overrideArg of overrideArgs) {
      const separatorIndex = overrideArg.indexOf('=');
      if (separatorIndex <= 0 || separatorIndex === overrideArg.length - 1) {
        return writeError(io, 'The source-ids-by-area-template command overrides must use area=source-id.');
      }
      const areaArg = overrideArg.slice(0, separatorIndex).trim();
      const sourceId = overrideArg.slice(separatorIndex + 1).trim();
      overrides[areaArg] = sourceId;
    }

    const template = buildFaceAuditSourceIdsByAreaTemplate(sourceArtifact, defaultSourceId, overrides);
    if (!template.ok || template.sourceIdsByArea === undefined) {
      return writeError(io, sourceIdsByAreaTemplateCliError(template.issues[0] ?? {
        field: 'sourceIdsByAreaOverrides',
        message: '',
      }));
    }

    writeJson(io, template.sourceIdsByArea);
    return 0;
  }

  if (command === 'evidence-ref-template') {
    const sourceId = filePath;
    const areaArg = extraArgs[0];
    const mode = extraArgs[1] ?? 'area';
    if (sourceId === undefined || areaArg === undefined || extraArgs.length > 2) {
      return writeError(io, 'The evidence-ref-template command expects source id, face-audit area, and optional mode area or items.');
    }
    if (!validEvidenceRefSourceId(sourceId)) {
      return writeError(io, 'The evidence-ref-template command expects a source id matching the evidenceRef source id format.');
    }
    const area = parseFaceAuditArea(areaArg);
    if (area === undefined) {
      return writeError(io, `Unknown face-audit area: ${areaArg}`);
    }
    const parsedMode = parseFaceAuditEvidenceRefMode(mode);
    if (parsedMode === undefined) {
      return writeError(io, 'The evidence-ref-template command mode must be area or items.');
    }
    writeJson(io, buildFaceAuditEvidenceRefTemplate(sourceId, area, parsedMode));
    return 0;
  }

  if (command === 'area-match-template') {
    const areaArg = filePath;
    const [sourceArtifactPath, sourceId, reviewerArg, reviewedAtArg, modeArg = 'area', ...unexpectedArgs] = extraArgs;
    if (
      areaArg === undefined ||
      sourceArtifactPath === undefined ||
      sourceId === undefined ||
      reviewerArg === undefined ||
      reviewedAtArg === undefined ||
      unexpectedArgs.length > 0
    ) {
      return writeError(io, 'The area-match-template command expects area, source artifact JSON file, source id, reviewer, reviewed-at timestamp, and optional mode area or items.');
    }
    const area = parseFaceAuditArea(areaArg);
    if (area === undefined) {
      return writeError(io, `Unknown face-audit area: ${areaArg}`);
    }
    if (!validEvidenceRefSourceId(sourceId)) {
      return writeError(io, 'The area-match-template command expects a source id matching the evidenceRef source id format.');
    }
    const reviewer = reviewerArg.trim();
    if (!reviewer) {
      return writeError(io, 'The area-match-template command expects a non-empty reviewer.');
    }
    const reviewedAt = reviewedAtArg.trim();
    if (!reviewedAt || !Number.isFinite(Date.parse(reviewedAt))) {
      return writeError(io, 'The area-match-template command expects reviewed-at to be a parseable timestamp.');
    }
    const mode = parseFaceAuditEvidenceRefMode(modeArg);
    if (mode === undefined) {
      return writeError(io, 'The area-match-template command mode must be area or items.');
    }

    let sourceArtifact: unknown;
    try {
      sourceArtifact = await readReviewArtifactJson(sourceArtifactPath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid source artifact JSON file: ${detail}`);
    }
    const evidenceSources = evidenceSourcesPayload(sourceArtifact);
    if (evidenceSources === undefined) {
      return writeError(io, 'The area-match-template command source artifact must include an evidenceSources array.');
    }
    const evidenceSource = evidenceSources.find((source) => evidenceSourceId(source) === sourceId);
    if (evidenceSource === undefined) {
      return writeError(io, `The area-match-template command source id is not declared in the source artifact: ${sourceId}`);
    }

    const validation = buildFaceAuditAreaMatchReviewArtifact(area, sourceArtifact, sourceId, reviewer, reviewedAt, mode);
    writeJson(io, validation.ok ? validation.review : validation);
    return validation.ok ? 0 : 1;
  }

  if (command === 'review-match-template') {
    const sourceArtifactPath = filePath;
    const [sourceId, reviewerArg, reviewedAtArg, modeArg = 'area', ...unexpectedArgs] = extraArgs;
    if (
      sourceArtifactPath === undefined ||
      sourceId === undefined ||
      reviewerArg === undefined ||
      reviewedAtArg === undefined ||
      unexpectedArgs.length > 0
    ) {
      return writeError(io, 'The review-match-template command expects source artifact JSON file, source id, reviewer, reviewed-at timestamp, and optional mode area or items.');
    }
    if (!validEvidenceRefSourceId(sourceId)) {
      return writeError(io, 'The review-match-template command expects a source id matching the evidenceRef source id format.');
    }
    const reviewer = reviewerArg.trim();
    if (!reviewer) {
      return writeError(io, 'The review-match-template command expects a non-empty reviewer.');
    }
    const reviewedAt = reviewedAtArg.trim();
    if (!reviewedAt || !Number.isFinite(Date.parse(reviewedAt))) {
      return writeError(io, 'The review-match-template command expects reviewed-at to be a parseable timestamp.');
    }
    const mode = parseFaceAuditEvidenceRefMode(modeArg);
    if (mode === undefined) {
      return writeError(io, 'The review-match-template command mode must be area or items.');
    }

    let sourceArtifact: unknown;
    try {
      sourceArtifact = await readReviewArtifactJson(sourceArtifactPath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid source artifact JSON file: ${detail}`);
    }
    const evidenceSources = evidenceSourcesPayload(sourceArtifact);
    if (evidenceSources === undefined) {
      return writeError(io, 'The review-match-template command source artifact must include an evidenceSources array.');
    }
    const evidenceSource = evidenceSources.find((source) => evidenceSourceId(source) === sourceId);
    if (evidenceSource === undefined) {
      return writeError(io, `The review-match-template command source id is not declared in the source artifact: ${sourceId}`);
    }

    const validation = buildFaceAuditMatchReviewArtifact(sourceArtifact, sourceId, reviewer, reviewedAt, mode);
    writeJson(io, validation.ok ? validation.review : validation);
    return validation.ok ? 0 : 1;
  }

  if (command === 'review-match-template-by-area') {
    const sourceArtifactPath = filePath;
    const [sourceIdsByAreaPath, reviewerArg, reviewedAtArg, modeArg = 'area', ...unexpectedArgs] = extraArgs;
    if (
      sourceArtifactPath === undefined ||
      sourceIdsByAreaPath === undefined ||
      reviewerArg === undefined ||
      reviewedAtArg === undefined ||
      unexpectedArgs.length > 0
    ) {
      return writeError(io, 'The review-match-template-by-area command expects source artifact JSON file, source-ids-by-area JSON file, reviewer, reviewed-at timestamp, and optional mode area or items.');
    }
    const reviewer = reviewerArg.trim();
    if (!reviewer) {
      return writeError(io, 'The review-match-template-by-area command expects a non-empty reviewer.');
    }
    const reviewedAt = reviewedAtArg.trim();
    if (!reviewedAt || !Number.isFinite(Date.parse(reviewedAt))) {
      return writeError(io, 'The review-match-template-by-area command expects reviewed-at to be a parseable timestamp.');
    }
    const mode = parseFaceAuditEvidenceRefMode(modeArg);
    if (mode === undefined) {
      return writeError(io, 'The review-match-template-by-area command mode must be area or items.');
    }

    let sourceArtifact: unknown;
    try {
      sourceArtifact = await readReviewArtifactJson(sourceArtifactPath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid source artifact JSON file: ${detail}`);
    }
    const evidenceSources = evidenceSourcesPayload(sourceArtifact);
    if (evidenceSources === undefined) {
      return writeError(io, 'The review-match-template-by-area command source artifact must include an evidenceSources array.');
    }

    let sourceIdsByArea: unknown;
    try {
      sourceIdsByArea = await readReviewArtifactJson(sourceIdsByAreaPath, io);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return writeError(io, `Could not read a valid source-ids-by-area JSON file: ${detail}`);
    }

    const validation = buildFaceAuditMappedMatchReviewArtifact(
      sourceArtifact,
      sourceIdsByArea,
      reviewer,
      reviewedAt,
      mode,
    );
    writeJson(io, validation.ok ? validation.review : validation);
    return validation.ok ? 0 : 1;
  }

  if (command === 'release-gate') {
    if (extraArgs.length > 0) {
      return writeError(io, 'The release-gate command accepts at most one lock artifact JSON file.');
    }
    let parsed: unknown;
    if (filePath !== undefined) {
      try {
        parsed = await readReviewArtifactJson(filePath, io);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return writeError(io, `Could not read a valid lock artifact JSON file: ${detail}`);
      }
    }
    const validation = validateFaceAuditStaticLockGate(parsed);
    writeJson(io, validation);
    return validation.ok ? 0 : 1;
  }

  return writeError(io, `Unknown face-audit command: ${command}`);
}

const thisFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedFilePath === thisFilePath) {
  const exitCode = await runFaceAuditCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
