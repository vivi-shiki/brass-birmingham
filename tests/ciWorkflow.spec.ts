import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const workflow = readFileSync('.github/workflows/verify.yml', 'utf8');
const faceAuditArtifactDirectory = 'face-audit-artifacts';

describe('CI workflow', () => {
  it('runs the same verify gate used locally', () => {
    expect(workflow).toContain('name: Verify');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('push:');
    expect(workflow).toContain('node-version: 22');
    expect(workflow).toContain('run: npm ci');
    expect(workflow).toContain('name: Build, test, release gate, and audit self-checks');
    expect(workflow).toContain('run: npm run verify');
    expect(workflow).toContain(`run: npm run face-audit:ci-artifacts -- ${faceAuditArtifactDirectory}`);
    expect(workflow).toContain(`run: npm run face-audit:verify-ci-artifacts -- ${faceAuditArtifactDirectory}`);
    expect(workflow).toContain('uses: actions/upload-artifact@v4');
    expect(workflow).toContain('name: face-audit-ci-artifacts');
    expect(workflow).toContain(`path: ${faceAuditArtifactDirectory}`);
    expect(workflow).toContain('if-no-files-found: error');
    expect(workflow).toContain('retention-days: 14');

    const installIndex = workflow.indexOf('run: npm ci');
    const verifyIndex = workflow.indexOf('run: npm run verify');
    const artifactIndex = workflow.indexOf(`run: npm run face-audit:ci-artifacts -- ${faceAuditArtifactDirectory}`);
    const verifyArtifactIndex = workflow.indexOf(`run: npm run face-audit:verify-ci-artifacts -- ${faceAuditArtifactDirectory}`);
    const uploadIndex = workflow.indexOf('uses: actions/upload-artifact@v4');
    expect(installIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeGreaterThan(installIndex);
    expect(artifactIndex).toBeGreaterThan(verifyIndex);
    expect(verifyArtifactIndex).toBeGreaterThan(artifactIndex);
    expect(uploadIndex).toBeGreaterThan(verifyArtifactIndex);
  });
});
