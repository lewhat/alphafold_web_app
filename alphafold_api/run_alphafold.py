import logging
import os
import shutil
import subprocess
import time
import boto3
import threading

from constants import ALPHAFOLD_REPO, DATA_DIR, OUTPUT_DIR, SEQUENCES_DIR
from gpu_utils import check_system_gpu, check_docker_gpu_access, verify_alphafold_gpu_usage, monitor_gpu_during_run

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_alphafold(job_id, sequence, name, job_status, storage_url=None, bucket_name=None, object_key=None):
    """Function to run AlphaFold in a separate thread"""
    try:
        # Update job status
        job_status[job_id] = {
            "status": "running",
            "progress": 0,
        }

        # Check GPU availability before starting
        gpu_available, gpu_info = check_system_gpu()
        job_status[job_id]["gpu_available"] = gpu_available
        job_status[job_id]["gpu_info"] = gpu_info

        if gpu_available:
            logger.info(f"GPU is available for job {job_id}: {gpu_info}")
        else:
            logger.warning(f"GPU is not available for job {job_id}: {gpu_info}")

        # Check Docker GPU access
        docker_gpu, docker_gpu_info = check_docker_gpu_access()
        job_status[job_id]["docker_gpu_access"] = docker_gpu
        job_status[job_id]["docker_gpu_info"] = docker_gpu_info

        if docker_gpu:
            logger.info(f"Docker has GPU access for job {job_id}")
        else:
            logger.warning(f"Docker does not have GPU access for job {job_id}: {docker_gpu_info}")

        # Start GPU monitoring in a separate thread
        monitor_thread = threading.Thread(
            target=monitor_gpu_during_run,
            args=(job_id, job_status)
        )
        monitor_thread.daemon = True  # Thread will exit when main thread exits
        monitor_thread.start()

        if bucket_name and object_key:
            job_status[job_id]["s3_bucket"] = bucket_name
            job_status[job_id]["s3_key"] = object_key
        elif storage_url:
            job_status[job_id]["storage_url"] = storage_url

        job_dir = os.path.join(OUTPUT_DIR, job_id)
        os.makedirs(job_dir, exist_ok=True)

        fasta_path = os.path.join(SEQUENCES_DIR, f"{job_id}.fasta")
        with open(fasta_path, "w") as f:
            f.write(f">{name}\n{sequence}\n")

        # Ensure --use_gpu=true is included to force GPU usage
        cmd = [
            "python3",
            os.path.join(ALPHAFOLD_REPO, "docker/run_docker.py"),
            f"--fasta_paths={fasta_path}",
            f"--max_template_date=2022-01-01",
            f"--data_dir={DATA_DIR}",
            f"--output_dir={job_dir}",
            "--use_gpu=true",  # Explicitly enable GPU
            "--enable_gpu_relax=false"
        ]

        logger.info(f"Starting AlphaFold for job {job_id}")
        logger.info(f"Command: {' '.join(cmd)}")

        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True
        )

        # Monitor process and update progress
        gpu_usage_detected = False
        while process.poll() is None:
            line = process.stdout.readline()
            if line:
                logger.info(f"AlphaFold output: {line.strip()}")

                # Look for evidence of GPU usage in the output
                if any(keyword in line for keyword in ["GPU", "gpu", "CUDA", "cuda", "device:GPU"]):
                    gpu_usage_detected = True
                    job_status[job_id]["gpu_usage_detected"] = True
                    job_status[job_id]["gpu_evidence"] = line.strip()

                # Update progress based on output (simplified example)
                if "Running model" in line:
                    job_status[job_id]["progress"] = 30
                elif "Relaxing structure" in line:
                    job_status[job_id]["progress"] = 70
            time.sleep(1)

        # Get any remaining output
        stdout, stderr = process.communicate()

        # Check if process completed successfully
        if process.returncode == 0:
            logger.info(f"AlphaFold completed successfully for job {job_id}")

            # Verify GPU usage in logs after completion
            gpu_used, gpu_evidence = verify_alphafold_gpu_usage(job_id, OUTPUT_DIR)
            job_status[job_id]["gpu_verification"] = {
                "gpu_used": gpu_used,
                "evidence": gpu_evidence
            }

            # Find the results directory (named after the FASTA file)
            results_dirs = [
                d
                for d in os.listdir(job_dir)
                if os.path.isdir(os.path.join(job_dir, d))
            ]
            if results_dirs:
                # Get the latest results directory
                result_dir = os.path.join(job_dir, sorted(results_dirs)[-1])

                # Look for the final PDB file (ranked_0.pdb is the top model)
                pdb_files = [
                    f
                    for f in os.listdir(result_dir)
                    if f.endswith(".pdb") and "ranked_0" in f
                ]

                if pdb_files:
                    result_file = pdb_files[0]
                    file_path = os.path.join(result_dir, result_file)

                    # Upload to S3 using boto3 if bucket info was provided
                    s3_uploaded = False
                    s3_bucket = job_status[job_id].get("s3_bucket")
                    s3_key = job_status[job_id].get("s3_key")

                    if s3_bucket and s3_key:
                        try:
                            # Upload file to S3 using boto3
                            logger.info(f"Uploading results to S3 bucket {s3_bucket} with key {s3_key}")
                            s3_client = boto3.client('s3')

                            # Progress callback for upload
                            def upload_progress(bytes_transferred):
                                # Only update for significant progress changes to avoid excessive logging
                                job_status[job_id]["upload_progress"] = min(
                                    int((bytes_transferred / os.path.getsize(file_path)) * 100),
                                    99  # Cap at 99% until fully complete
                                )

                            # Upload the file with progress tracking
                            with open(file_path, 'rb') as file_data:
                                s3_client.upload_fileobj(
                                    file_data,
                                    s3_bucket,
                                    s3_key,
                                    Callback=upload_progress
                                )

                            s3_uploaded = True
                            logger.info(f"Successfully uploaded {result_file} to S3 for job {job_id}")
                        except Exception as e:
                            logger.error(f"Error uploading to S3 with boto3: {str(e)}")

                            # Fallback to pre-signed URL if available
                            s3_url = job_status[job_id].get("storage_url")
                            if s3_url:
                                try:
                                    import requests
                                    logger.info("Falling back to pre-signed URL upload method")
                                    with open(file_path, "rb") as f:
                                        response = requests.put(s3_url, data=f)

                                    if response.status_code == 200:
                                        s3_uploaded = True
                                        logger.info(f"Successfully uploaded {result_file} to S3 using pre-signed URL for job {job_id}")
                                    else:
                                        logger.error(f"Failed to upload to S3 with pre-signed URL: {response.status_code} {response.text}")
                                except Exception as e2:
                                    logger.error(f"Error uploading to S3 with pre-signed URL: {str(e2)}")

                    # Copy the file to a known location for easier access
                    output_file = os.path.join(job_dir, "ranked_0.pdb")
                    shutil.copy(file_path, output_file)

                    job_status[job_id] = {
                        "status": "completed",
                        "progress": 100,
                        "result_file": output_file,
                        "s3_uploaded": s3_uploaded,
                        "gpu_available": gpu_available,
                        "gpu_info": gpu_info,
                        "docker_gpu_access": docker_gpu,
                        "gpu_usage_detected": gpu_usage_detected,
                        "gpu_verification": {
                            "gpu_used": gpu_used,
                            "evidence": gpu_evidence
                        }
                    }
                else:
                    job_status[job_id] = {
                        "status": "error",
                        "message": "No PDB files found in results directory",
                        "gpu_available": gpu_available,
                        "gpu_info": gpu_info,
                        "docker_gpu_access": docker_gpu,
                        "gpu_usage_detected": gpu_usage_detected
                    }
            else:
                job_status[job_id] = {
                    "status": "error",
                    "message": "No results directory found",
                    "gpu_available": gpu_available,
                    "gpu_info": gpu_info,
                    "docker_gpu_access": docker_gpu,
                    "gpu_usage_detected": gpu_usage_detected
                }
        else:
            logger.error(f"AlphaFold failed for job {job_id}: {stderr}")
            job_status[job_id] = {
                "status": "error",
                "message": stderr,
                "gpu_available": gpu_available,
                "gpu_info": gpu_info,
                "docker_gpu_access": docker_gpu,
                "gpu_usage_detected": gpu_usage_detected
            }

    except Exception as e:
        logger.error(f"Error running AlphaFold for job {job_id}: {str(e)}")
        job_status[job_id] = {"status": "error", "message": str(e)}
