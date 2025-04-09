import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import {
  addToQueue,
  addToLog,
  removeFromQueue,
  getQueuedJob,
  getLoggedJob,
  updateLoggedJob,
  getAllJobs,
} from "../services/queueService";
import {
  generateSasUrl,
  getContainerName,
  getStorageAccountName,
  checkBlobExists,
} from "../services/blobServices";
import { JobData, SubmitSequenceRequest } from "../../shared/types";
import { isValidSequence } from "../../shared/utils";


export const submitSequence = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { sequence } = req.body as SubmitSequenceRequest;

    if (!sequence) {
      res.status(400).json({ error: "Sequence is required" });
      return;
    }

    if (!isValidSequence(sequence)) {
      res.status(400).json({
        error:
          "Invalid protein sequence. Use standard amino acid codes (ACDEFGHIKLMNPQRSTVWY).",
      });
      return;
    }

    const jobId = uuidv4();
    const storageName = `proteins/${jobId}.pdb`;

    const storageUrl = await generateSasUrl(storageName);

    const jobData: JobData = {
      jobId,
      sequence,
      status: "queued",
      storageName,
      storageUrl,
      submittedAt: new Date().toISOString(),
    };

    await addToQueue(jobData);

    try {
      const alphafoldVmEndpoint = process.env.ALPHAFOLD_VM_ENDPOINT;
      if (!alphafoldVmEndpoint) {
        throw new Error(
          "ALPHAFOLD_VM_ENDPOINT environment variable is not set",
        );
      }

      await axios.post(alphafoldVmEndpoint, {
        platform: "azure",
        jobId,
        sequence,
        storageAccount: getStorageAccountName(),
        containerName: getContainerName(),
        storageName,
        storageUrl,
      });

      jobData.status = "processing";
      await addToLog(jobData);
      await removeFromQueue(jobId);
    } catch (error) {
      console.error("Error sending job to AlphaFold VM:", error);
      jobData.status = "error";
      jobData.error = "Failed to send to AlphaFold VM";
      await addToLog(jobData);
    }

    res.status(200).json({
      jobId,
      storageUrl,
      message: "Sequence submitted successfully",
    });
  } catch (error) {
    console.error("Error submitting sequence:", error);
    res.status(500).json({ error: "Server error processing sequence" });
  }
};

export const getJobStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { jobId } = req.params;

    console.log(`Checking status for job: ${jobId}`);

    const queuedJob = await getQueuedJob(jobId);

    if (queuedJob) {
      console.log(`Job ${jobId} found in queue: ${JSON.stringify(queuedJob)}`);
      res.status(200).json({
        ...queuedJob,
        message: "Job is queued for processing",
      });
      return;
    }

    const loggedJob = await getLoggedJob(jobId);

    if (loggedJob) {
      console.log(`Job ${jobId} found in log: ${JSON.stringify(loggedJob)}`);

      if (
        loggedJob.status === "processing" ||
        loggedJob.status === "completed"
      ) {
        const storageUrl = await generateSasUrl(loggedJob.storageName);
        const blobExists = await checkBlobExists(loggedJob.storageName);

        const response = {
          ...loggedJob,
          storageUrl,
          status: blobExists ? "completed" : "processing",
          uploaded: blobExists,
          message: "Job has been processed",
        };

        console.log(`Returning job status with storageUrl for job ${jobId}`);
        console.log(`Response includes upload status: ${response.uploaded}`);
        console.log(
          `Response includes storageUrl: ${storageUrl ? "Yes" : "No"}`,
        );

        res.status(200).json(response);
        return;
      }

      res.status(200).json({
        ...loggedJob,
        message: "Job has been processed",
      });
      return;
    }

    console.log(`Job ${jobId} not found in queue or log`);
    res.status(404).json({ error: "Job not found" });
  } catch (error) {
    console.error("Error getting job status:", error);
    res.status(500).json({ error: "Server error checking job status" });
  }
};

export const checkResult = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { jobId } = req.params;

    const loggedJob = await getLoggedJob(jobId);

    if (!loggedJob) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    try {
      const exists = await checkBlobExists(loggedJob.storageName);

      if (exists) {
        if (loggedJob.status === "processing") {
          await updateLoggedJob(jobId, {
            status: "completed",
            completedAt: new Date().toISOString(),
          });
        }

        const storageUrl = await generateSasUrl(loggedJob.storageName);

        res.status(200).json({
          jobId,
          status: "completed",
          storageUrl,
          message: "Result is available",
        });
      } else {
        res.status(200).json({
          jobId,
          status: "processing",
          message: "Result is not available yet",
        });
      }
    } catch (error) {
      console.error("Error checking blob:", error);
      throw error;
    }
  } catch (error) {
    console.error("Error checking result:", error);
    res.status(500).json({ error: "Server error checking result" });
  }
};

export const listAllJobs = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const jobs = await getAllJobs();
    res.status(200).json(jobs);
  } catch (error) {
    console.error("Error listing jobs:", error);
    res.status(500).json({ error: "Server error listing jobs" });
  }
};
