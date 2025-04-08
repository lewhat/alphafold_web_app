import logging
import os
import subprocess
import threading
import time

import run_alphafold
from constants import DATA_DIR, OUTPUT_DIR, SEQUENCES_DIR
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from gpu_utils import check_docker_gpu_access, check_system_gpu

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create directories if they don't exist
for directory in [DATA_DIR, OUTPUT_DIR, SEQUENCES_DIR]:
    os.makedirs(directory, exist_ok=True)

# Store job statuses
job_status = {}


@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.json
        if not data or "sequence" not in data:
            return jsonify({"error": "Protein sequence is required"}), 400

        platform = data.get('platform')
        sequence = data["sequence"]
        name = data.get("name", "protein")
        storage_url = data.get("storageUrl")
        bucket_name = data.get("storageAccount") if platform == 'aws' else data.get('bucketName')
        object_key = data.get("blobName") if platform == 'azure' else  data.get("objectKey")

        if platform == 'azure':
            container_name = data.get('containerName')

        job_id = data.get("jobId")

        # Start AlphaFold in a separate thread
        if platform == 'azure':
            args=(
                job_id,
                sequence,
                name,
                job_status,
                storage_url,
                bucket_name,
                object_key,
                container_name
            )
        else:
            args=(
                job_id,
                sequence,
                name,
                job_status,
                storage_url,
                bucket_name,
                object_key,
            )

        thread = threading.Thread(
            target=run_alphafold.run_alphafold, args=args
        )
        thread.start()

        return jsonify({"job_id": job_id, "status": "submitted"})

    except Exception as e:
        logger.error(f"Error in predict endpoint: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/status/<job_id>", methods=["GET"])
def get_status(job_id):
    if job_id not in job_status:
        return jsonify({"error": "Job not found"}), 404

    return jsonify(job_status[job_id])


@app.route("/result/<job_id>", methods=["GET"])
def get_result(job_id):
    if job_id not in job_status:
        return jsonify({"error": "Job not found"}), 404

    status = job_status[job_id]
    if status["status"] != "completed":
        return jsonify({"error": "Job not completed yet"}), 400

    result_file = status.get("result_file")
    if not result_file:
        return jsonify({"error": "Result file not found"}), 404

    if not os.path.exists(result_file):
        return jsonify({"error": "Result file does not exist"}), 404

    return send_file(result_file, as_attachment=True)


@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "healthy"})


@app.route("/gpu-info", methods=["GET"])
def gpu_info():
    try:
        # Check system GPU
        gpu_available, gpu_info = check_system_gpu()

        # Check Docker GPU access
        docker_gpu, docker_gpu_info = check_docker_gpu_access()

        # Get detailed GPU information using nvidia-smi
        detailed_info = {}
        try:
            nvidia_smi = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=index,name,driver_version,temperature.gpu,utilization.gpu,utilization.memory,memory.total,memory.free,memory.used",
                    "--format=csv",
                ],
                capture_output=True,
                text=True,
                check=True,
            )

            if nvidia_smi.returncode == 0:
                lines = nvidia_smi.stdout.strip().split("\n")
                if len(lines) > 1:  # Header + at least one GPU
                    headers = [h.strip() for h in lines[0].split(",")]
                    for i, line in enumerate(lines[1:]):
                        values = [v.strip() for v in line.split(",")]
                        gpu_data = {headers[j]: values[j] for j in range(len(headers))}
                        detailed_info[f"gpu_{i}"] = gpu_data
        except Exception as e:
            logger.error(f"Error getting detailed GPU info: {e}")
            detailed_info = {"error": str(e)}

        # Get GPU usage in current jobs
        jobs_using_gpu = []
        for job_id, status in job_status.items():
            if status.get("gpu_usage_detected", False) or status.get(
                "gpu_verification", {}
            ).get("gpu_used", False):
                jobs_using_gpu.append(
                    {
                        "job_id": job_id,
                        "status": status.get("status"),
                        "progress": status.get("progress"),
                        "gpu_evidence": status.get("gpu_evidence", ""),
                        "gpu_verification": status.get("gpu_verification", {}),
                    }
                )

        # Get Docker container GPU usage
        docker_containers = []
        try:
            containers = subprocess.run(
                ["docker", "ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}"],
                capture_output=True,
                text=True,
                check=True,
            )

            if containers.returncode == 0:
                container_lines = containers.stdout.strip().split("\n")
                for line in container_lines:
                    if line:
                        parts = line.split("\t")
                        if len(parts) >= 3:
                            container_id, name, image = parts

                            # Check if this container is using GPU
                            try:
                                # Try to run nvidia-smi inside the container
                                test = subprocess.run(
                                    ["docker", "exec", container_id, "nvidia-smi"],
                                    capture_output=True,
                                    text=True,
                                )
                                using_gpu = test.returncode == 0
                            except:
                                using_gpu = False

                            docker_containers.append(
                                {
                                    "id": container_id,
                                    "name": name,
                                    "image": image,
                                    "using_gpu": using_gpu,
                                }
                            )
        except Exception as e:
            logger.error(f"Error checking Docker containers: {e}")
            docker_containers = [{"error": str(e)}]

        return jsonify(
            {
                "system_gpu_available": gpu_available,
                "system_gpu_info": gpu_info,
                "docker_gpu_access": docker_gpu,
                "docker_gpu_info": docker_gpu_info,
                "detailed_gpu_info": detailed_info,
                "jobs_using_gpu": jobs_using_gpu,
                "docker_containers": docker_containers,
                "timestamp": time.time(),
            }
        )
    except Exception as e:
        logger.error(f"Error in GPU info endpoint: {str(e)}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
