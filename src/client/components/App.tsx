import React, { useState, useEffect } from "react";
import SequenceInput from "./SequenceInput";
import ProteinViewer from "./ProteinViewer";
import { submitSequence, getJobStatus } from "../services/api";

interface StoredJob {
  jobId: string;
  sequence: string;
  timestamp: number;
}

const App: React.FC = () => {
  const [sequence, setSequence] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const [inputJobId, setInputJobId] = useState<string>("");
  const [storageUrl, setStorageUrl] = useState<string | null>(null);
  const [structureData, setStructureData] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);
  const [recentJobs, setRecentJobs] = useState<StoredJob[]>([]);

  // Load recent jobs from localStorage on initial load
  useEffect(() => {
    const storedJobs = localStorage.getItem("alphafold_recent_jobs");
    if (storedJobs) {
      try {
        const parsedJobs = JSON.parse(storedJobs) as StoredJob[];
        setRecentJobs(parsedJobs);

        // If there's a recent job and no active job ID, suggest the most recent one
        if (parsedJobs.length > 0 && !jobId) {
          const mostRecent = parsedJobs[0];
          setInputJobId(mostRecent.jobId);
          setStatusMessage(
            `Welcome back! You have a recent job (${mostRecent.jobId}). Click "Resume Tracking" to check its status.`,
          );
        }
      } catch (e) {
        console.error("Error parsing stored jobs", e);
      }
    }
  }, []);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [pollInterval]);

  // Start polling when jobId is set and polling is enabled
  useEffect(() => {
    if (jobId && isPolling) {
      if (pollInterval) clearInterval(pollInterval);

      const interval = setInterval(async () => {
        await checkJobStatus(jobId);
      }, 60000);

      setPollInterval(interval);

      checkJobStatus(jobId);
    } else if (!isPolling && pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }
  }, [jobId, isPolling]);

  // Store job in localStorage
  const storeJob = (id: string, seq: string) => {
    const newJob: StoredJob = {
      jobId: id,
      sequence: seq,
      timestamp: Date.now(),
    };

    const updatedJobs = [
      newJob,
      ...recentJobs.filter((job) => job.jobId !== id), // Remove this job if it was already in the list
    ].slice(0, 5); // Keep only the 5 most recent

    setRecentJobs(updatedJobs);

    // Store in localStorage
    localStorage.setItem("alphafold_recent_jobs", JSON.stringify(updatedJobs));
  };

  const checkJobStatus = async (id: string) => {
    try {
      setStatusMessage(`Checking status for job ${id}...`);
      console.log(`Fetching status for job ${id}`);
      const status = await getJobStatus(id);
      console.log(`Received status:`, status);

      if (status.status === "completed") {
        setStatusMessage("Job completed! Fetching structure data...");
        console.log(
          `Job completed. uploaded=${status.uploaded}, storageUrl=${status.storageUrl ? "exists" : "missing"}`,
        );

        if (status.uploaded && status.storageUrl) {
          console.log(`Using S3 URL: ${status.storageUrl}`);
          setStorageUrl(status.storageUrl);

          console.log(`Fetching structure data from S3`);
          const response = await fetch(status.storageUrl);
          console.log(`S3 fetch response status: ${response.status}`);

          if (!response.ok) {
            console.error(
              `Error fetching from S3: ${response.status} ${response.statusText}`,
            );
            throw new Error(`Failed to fetch from S3: ${response.status}`);
          }

          const pdbData = await response.text();
          console.log(`Received PDB data of length: ${pdbData.length}`);
          console.log(`First 100 chars: ${pdbData.substring(0, 100)}`);
          setStructureData(pdbData);
        } else {
          console.log(`Falling back to API fetch for result`);
          const response = await fetch(`/api/check-result/${id}`);
          console.log(`API fetch response status: ${response.status}`);

          if (!response.ok) {
            console.error(
              `Error fetching from API: ${response.status} ${response.statusText}`,
            );
            throw new Error(`Failed to fetch from API: ${response.status}`);
          }

          const pdbData = await response.text();
          console.log(`Received PDB data of length: ${pdbData.length}`);
          console.log(`First 100 chars: ${pdbData.substring(0, 100)}`);
          setStructureData(pdbData);
        }

        setStatusMessage("Structure prediction complete!");

        setIsPolling(false);
        if (pollInterval) {
          clearInterval(pollInterval);
          setPollInterval(null);
        }
      } else if (status.status === "processing") {
        setStatusMessage(
          `Job is still running.`,
        );
      } else if (status.status === "error") {
        setError(`Error in prediction: ${status.message || "Unknown error"}`);
        setIsPolling(false);
      } else if (status.status === "submitted") {
        setStatusMessage("Job is queued and waiting to start processing.");
      } else {
        setStatusMessage(`Current status: ${status.status}`);
      }
    } catch (err: any) {
      console.error(`Error checking job status:`, err);
      setError(err.message || "Error checking job status");
    }
  };

  const handleSubmit = async () => {
    if (!sequence.trim()) {
      setError("Please enter a protein sequence");
      return;
    }

    setSubmitting(true);
    setError(null);
    setStructureData(null);
    setStorageUrl(null);
    setStatusMessage(null);

    try {
      const response = await submitSequence(sequence);
      const newJobId = response.jobId;

      storeJob(newJobId, sequence);

      setJobId(newJobId);
      setInputJobId(newJobId); // Auto-fill the job ID input
      setStatusMessage(`Job submitted successfully. Job ID: ${newJobId}`);

      setIsPolling(true);
    } catch (err: any) {
      setError(err.message || "Error submitting sequence");
    } finally {
      setSubmitting(false);
    }
  };

  // Manual check button handler
  const handleCheckStatus = async () => {
    if (!inputJobId.trim()) {
      setError("Please enter a job ID");
      return;
    }

    setLoading(true);
    setError(null);

    setJobId(inputJobId);
    setIsPolling(true);
    setLoading(false);
  };

  // Toggle polling on/off
  const togglePolling = () => {
    setIsPolling(!isPolling);
  };

  // Select a job from recent jobs list
  const selectRecentJob = (job: StoredJob) => {
    setInputJobId(job.jobId);
    setSequence(job.sequence);
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="container mx-auto p-4">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold mb-2">
          AlphaFold Protein Structure Prediction
        </h1>
        <p className="text-gray-600">
          Enter a protein sequence to predict its 3D structure using AlphaFold
        </p>
      </header>

      <SequenceInput
        sequence={sequence}
        setSequence={setSequence}
        onSubmit={handleSubmit}
        isLoading={submitting}
      />

      {/* Recent Jobs Section */}
      {recentJobs.length > 0 && (
        <div className="mt-6 p-4 bg-white rounded-lg border">
          <h2 className="text-lg font-semibold mb-2">Recent Jobs</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
              <thead>
                <tr>
                  <th className="py-2 px-4 border-b text-left">Job ID</th>
                  <th className="py-2 px-4 border-b text-left">Submitted</th>
                  <th className="py-2 px-4 border-b text-left">Sequence</th>
                  <th className="py-2 px-4 border-b text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr key={job.jobId} className="hover:bg-gray-50">
                    <td className="py-2 px-4 border-b">{job.jobId}</td>
                    <td className="py-2 px-4 border-b">
                      {formatTimestamp(job.timestamp)}
                    </td>
                    <td className="py-2 px-4 border-b">
                      {job.sequence.length > 20
                        ? `${job.sequence.substring(0, 20)}...`
                        : job.sequence}
                    </td>
                    <td className="py-2 px-4 border-b">
                      <button
                        onClick={() => selectRecentJob(job)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Job Status Section */}
      <div className="mt-8 p-4 bg-gray-50 rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Check Prediction Status</h2>
        <p className="text-sm text-gray-600 mb-4">
          Protein structure prediction can take several hours. Enter your job ID
          to check the status.
        </p>

        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <input
            type="text"
            value={inputJobId}
            onChange={(e) => setInputJobId(e.target.value)}
            placeholder="Enter Job ID"
            className="flex-grow px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleCheckStatus}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300"
          >
            {loading ? "Loading..." : "Resume Tracking"}
          </button>
        </div>

        {jobId && (
          <div className="flex items-center mb-4">
            <span className="mr-4">Auto-update status:</span>
            <button
              onClick={togglePolling}
              className={`px-4 py-2 rounded-md ${isPolling
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-gray-200 hover:bg-gray-300 text-gray-800"
                }`}
            >
              {isPolling ? "On (Every Minute)" : "Off"}
            </button>
          </div>
        )}

        {statusMessage && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded">
            {statusMessage}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mt-4">
          {error}
        </div>
      )}

      {/* Structure viewer section */}
      {structureData && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-2">Predicted Structure</h2>
          <ProteinViewer structureData={structureData} storageUrl={storageUrl || ''} height={800}/>

          {storageUrl && (
            <div className="mt-4">
              <a
                href={storageUrl}
                className="text-blue-600 hover:text-blue-800"
                target="_blank"
                rel="noopener noreferrer"
              >
                Download PDB File
              </a>
            </div>
          )}
        </div>
      )}

      {/* Information section about prediction time */}
      <div className="mt-8 p-4 bg-yellow-50 border border-yellow-100 rounded-lg text-gray-700">
        <h3 className="font-semibold mb-2">About Prediction Time</h3>
        <p>
          AlphaFold protein structure prediction is computationally intensive
          and may take several hours to complete, depending on the protein size
          and server load. The app will automatically check for updates every
          minute. If you navigate away, you can return later and enter your Job
          ID to resume tracking.
        </p>
      </div>
    </div>
  );
};

export default App;
