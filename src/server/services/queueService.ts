import fs from 'fs';
import path from 'path';
import { JobData } from '../../shared/types';

const DATA_DIR = path.join(__dirname, '../../../data');
const QUEUE_JSON_PATH = path.join(DATA_DIR, 'queue.json');
const LOG_JSON_PATH = path.join(DATA_DIR, 'log.json');

export async function ensureDataDirectories(): Promise<void> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    if (!fs.existsSync(QUEUE_JSON_PATH)) {
      fs.writeFileSync(QUEUE_JSON_PATH, JSON.stringify([]));
    }
    
    if (!fs.existsSync(LOG_JSON_PATH)) {
      fs.writeFileSync(LOG_JSON_PATH, JSON.stringify([]));
    }
  } catch (error) {
    console.error('Error ensuring data directories:', error);
    throw error;
  }
}

export async function addToQueue(jobData: JobData): Promise<void> {
  await ensureDataDirectories();
  const queueContent: JobData[] = JSON.parse(fs.readFileSync(QUEUE_JSON_PATH, 'utf8'));
  queueContent.push(jobData);
  fs.writeFileSync(QUEUE_JSON_PATH, JSON.stringify(queueContent, null, 2));
}

export async function addToLog(jobData: JobData): Promise<void> {
  await ensureDataDirectories();
  const logContent: JobData[] = JSON.parse(fs.readFileSync(LOG_JSON_PATH, 'utf8'));
  logContent.push({
    ...jobData,
    processedAt: new Date().toISOString()
  });
  fs.writeFileSync(LOG_JSON_PATH, JSON.stringify(logContent, null, 2));
}

export async function removeFromQueue(jobId: string): Promise<void> {
  await ensureDataDirectories();
  const queueContent: JobData[] = JSON.parse(fs.readFileSync(QUEUE_JSON_PATH, 'utf8'));
  const updatedQueue = queueContent.filter(job => job.jobId !== jobId);
  fs.writeFileSync(QUEUE_JSON_PATH, JSON.stringify(updatedQueue, null, 2));
}

export async function getQueuedJob(jobId: string): Promise<JobData | null> {
  await ensureDataDirectories();
  const queueContent: JobData[] = JSON.parse(fs.readFileSync(QUEUE_JSON_PATH, 'utf8'));
  return queueContent.find(job => job.jobId === jobId) || null;
}

export async function getLoggedJob(jobId: string): Promise<JobData | null> {
  await ensureDataDirectories();
  const logContent: JobData[] = JSON.parse(fs.readFileSync(LOG_JSON_PATH, 'utf8'));
  return logContent.find(job => job.jobId === jobId) || null;
}

export async function updateLoggedJob(jobId: string, updates: Partial<JobData>): Promise<JobData | null> {
  await ensureDataDirectories();
  const logContent: JobData[] = JSON.parse(fs.readFileSync(LOG_JSON_PATH, 'utf8'));
  
  const index = logContent.findIndex(job => job.jobId === jobId);
  if (index === -1) return null;
  
  const updatedJob = { ...logContent[index], ...updates };
  logContent[index] = updatedJob;
  
  fs.writeFileSync(LOG_JSON_PATH, JSON.stringify(logContent, null, 2));
  return updatedJob;
}

export async function getAllJobs(): Promise<{ queued: JobData[], processed: JobData[] }> {
  await ensureDataDirectories();
  const queueContent: JobData[] = JSON.parse(fs.readFileSync(QUEUE_JSON_PATH, 'utf8'));
  const logContent: JobData[] = JSON.parse(fs.readFileSync(LOG_JSON_PATH, 'utf8'));
  
  return {
    queued: queueContent,
    processed: logContent
  };
}

