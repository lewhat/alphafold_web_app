export interface JobData {
  jobId: string;
  sequence: string;
  status: "submitted" | "queued" | "processing" | "completed" | "error";
  objectKey: string;
  submittedAt: string;
  processedAt?: string;
  completedAt?: string;
  error?: string;
  uploaded?: boolean;
  storageUrl?: string;
}

export interface SubmitSequenceRequest {
  sequence: string;
}

export interface SubmitSequenceResponse {
  jobId: string;
  storageUrl: string;
  message: string;
}

export interface JobStatusResponse extends JobData {
  progress?: number;
  message: string;
}

export interface CheckResultResponse {
  jobId: string;
  status: string;
  storageUrl?: string;
  message: string;
}

export interface AlphaFoldRequest {
  jobId: string;
  sequence: string;
  bucketName: string;
  objectKey: string;
}

declare global {
  interface Window {
    $3Dmol: any;
    jQuery: any;
  }
}
