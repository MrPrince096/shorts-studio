export type StageName = 'script' | 'voice' | 'captions' | 'visuals' | 'render';
export type JobStatus = 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Stage {
  id: StageName;
  label: string;
  requiresApproval: boolean;
  sceneScoped: boolean;
}

export interface ProjectSettings {
  aspectRatio: string;
  frameRate: number;
  language: string;
  width?: number;
  height?: number;
  voice?: string;
}

export interface Scene {
  id: string;
  order: number;
  title: string;
  narration: string;
  visualPrompt: string;
  durationMs: number;
}

export interface Asset {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'font' | 'data';
  uri: string;
  source: string;
  metadata: Record<string, string | number | boolean>;
}

export interface TimelineClip {
  id: string;
  sceneId: string;
  assetId: string;
  track: 'video' | 'audio' | 'caption';
  startMs: number;
  durationMs: number;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  scenes: Scene[];
  assets: Asset[];
  timeline: TimelineClip[];
}

export interface GenerationJob {
  id: string;
  projectId: string;
  stage: StageName;
  status: JobStatus;
  sceneIds: string[];
  attempts: number;
  outputArtifactIds: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  projectId: string;
  stage: StageName;
  sceneId: string | null;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

export interface Artifact {
  id: string;
  projectId: string;
  stage: StageName;
  sceneId: string | null;
  kind: 'script' | 'audio' | 'captions' | 'visual' | 'video';
  uri: string;
  checksum: string;
  metadata: Record<string, unknown>;
}
