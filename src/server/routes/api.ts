import express from 'express';
import {
  submitSequence,
  getJobStatus,
  checkResult,
  listAllJobs
} from '../controllers/sequenceController';

const router = express.Router();

router.post('/submit-sequence', submitSequence);

router.get('/job-status/:jobId', getJobStatus);

router.get('/check-result/:jobId', checkResult);

router.get('/admin/jobs', listAllJobs);

export default router;
