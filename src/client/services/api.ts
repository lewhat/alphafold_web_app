import axios from "axios";
import {
  SubmitSequenceResponse,
  JobStatusResponse,
  CheckResultResponse,
} from "../../shared/types";

const API_BASE_URL =
  process.env.NODE_ENV === "production" ? "" : "http://localhost:3001";

export const submitSequence = async (
  sequence: string,
): Promise<SubmitSequenceResponse> => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/submit-sequence`, {
      sequence,
    });
    return response.data;
  } catch (error: any) {
    if (error.response && error.response.data) {
      throw new Error(error.response.data.error || "Failed to submit sequence");
    }
    throw new Error("Network error. Please try again later.");
  }
};

export const getJobStatus = async (
  jobId: string,
): Promise<JobStatusResponse> => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/job-status/${jobId}`);
    return response.data;
  } catch (error: any) {
    if (error.response && error.response.data) {
      throw new Error(error.response.data.error || "Failed to get job status");
    }
    throw new Error("Network error. Please try again later.");
  }
};

export const checkResult = async (
  jobId: string,
): Promise<CheckResultResponse> => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/check-result/${jobId}`,
    );
    return response.data;
  } catch (error: any) {
    if (error.response && error.response.data) {
      throw new Error(error.response.data.error || "Failed to check result");
    }
    throw new Error("Network error. Please try again later.");
  }
};
