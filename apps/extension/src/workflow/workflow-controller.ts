import type { PolicyDecision, WorkflowKind } from '../platform/practice-policy.js';
import type { CaptureDraft } from '../platform/question-capture.js';

export type WorkflowState =
  | { kind: 'signedOut' }
  | { kind: 'noEntitlement' }
  | { kind: 'ready' }
  | { kind: 'questionReview'; prompt: string }
  | { kind: 'generating'; prompt: string }
  | { kind: 'answerReview'; prompt: string; answer: string }
  | { kind: 'error'; code: string };

export type WorkflowContext = { workflow: WorkflowKind; userInitiated: boolean };

export type WorkflowDependencies = {
  capture(): Promise<CaptureDraft | null>;
  generate(prompt: string, signal: AbortSignal): Promise<{ answer: string }>;
  insert(text: string): Promise<void>;
  getContext(): Promise<WorkflowContext>;
};

export type WorkflowDecision = PolicyDecision;

export class WorkflowController {
  private state: WorkflowState = { kind: 'ready' };
  private context: WorkflowContext = { workflow: 'unknown', userInitiated: false };
  private prompt = '';
  private answer = '';
  private questionConfirmed = false;
  private answerApproved = false;
  private controller: AbortController | null = null;
  private generationId = 0;
  private signedOut = false;

  constructor(private readonly dependencies: WorkflowDependencies) {}

  getState(): WorkflowState { return { ...this.state }; }

  updateContext(context: WorkflowContext): void { this.context = context; }

  setAuthentication(entitled: boolean): void {
    if (!this.signedOut) this.state = entitled ? { kind: 'ready' } : { kind: 'noEntitlement' };
  }

  async capture(): Promise<void> {
    await this.refreshContext();
    if (!this.ensurePolicy()) return;
    const draft = await this.dependencies.capture();
    if (!draft) {
      this.state = { kind: 'error', code: 'QUESTION_UNAVAILABLE' };
      return;
    }
    this.prompt = draft.prompt;
    this.answer = '';
    this.questionConfirmed = false;
    this.answerApproved = false;
    this.state = { kind: 'questionReview', prompt: this.prompt };
  }

  async setPrompt(prompt: string): Promise<void> {
    await this.refreshContext();
    if (!this.ensurePolicy()) return;
    const normalized = prompt.replace(/\s+/g, ' ').trim();
    if (normalized.length < 12) {
      this.state = { kind: 'error', code: 'QUESTION_TOO_SHORT' };
      return;
    }
    this.prompt = normalized;
    this.questionConfirmed = false;
    this.answerApproved = false;
    this.state = { kind: 'questionReview', prompt: normalized };
  }

  async confirmQuestion(): Promise<void> {
    if (this.state.kind !== 'questionReview') return;
    await this.refreshContext();
    if (!this.ensurePolicy()) return;
    this.questionConfirmed = true;
    const generationId = ++this.generationId;
    const controller = new AbortController();
    this.controller = controller;
    this.state = { kind: 'generating', prompt: this.prompt };
    try {
      const result = await this.dependencies.generate(this.prompt, controller.signal);
      if (controller.signal.aborted || generationId !== this.generationId) return;
      this.answer = result.answer;
      this.answerApproved = false;
      this.state = { kind: 'answerReview', prompt: this.prompt, answer: this.answer };
    } catch {
      if (controller.signal.aborted || generationId !== this.generationId) return;
      this.state = { kind: 'error', code: 'PROVIDER_UNAVAILABLE' };
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  approveAnswer(): void {
    if (this.state.kind === 'answerReview' && this.questionConfirmed) this.answerApproved = true;
  }

  async insert(): Promise<void> {
    if (this.state.kind !== 'answerReview' || !this.answerApproved) return;
    await this.refreshContext();
    if (!this.ensurePolicy()) return;
    await this.dependencies.insert(this.answer);
    this.resetContent();
    this.state = { kind: 'ready' };
  }

  cancel(): void {
    this.generationId += 1;
    this.controller?.abort();
    this.controller = null;
    this.resetContent();
    if (!this.signedOut) this.state = { kind: 'ready' };
  }

  signOut(): void {
    this.signedOut = true;
    this.generationId += 1;
    this.controller?.abort();
    this.controller = null;
    this.resetContent();
    this.state = { kind: 'signedOut' };
  }

  private async refreshContext(): Promise<void> {
    this.context = await this.dependencies.getContext();
  }

  private ensurePolicy(): boolean {
    const decision = evaluatePolicy(this.context);
    if (decision.allowed) return true;
    this.state = { kind: 'error', code: decision.reason };
    return false;
  }

  private resetContent(): void {
    this.prompt = '';
    this.answer = '';
    this.questionConfirmed = false;
    this.answerApproved = false;
  }
}

function evaluatePolicy(context: WorkflowContext): WorkflowDecision {
  if (context.workflow !== 'practice') {
    return { allowed: false, reason: 'WORKFLOW_NOT_AUTHORIZED' };
  }
  if (!context.userInitiated) return { allowed: false, reason: 'USER_ACTION_REQUIRED' };
  return { allowed: true, reason: null };
}

export function createWorkflowController(dependencies: WorkflowDependencies): WorkflowController {
  return new WorkflowController(dependencies);
}
