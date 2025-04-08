import logging
import os
import shutil
import subprocess
import time
import threading
from azure.storage.blob import BlobClient
from azure.identity import DefaultAzureCredential

from constants import ALPHAFOLD_REPO, DATA_DIR, OUTPUT_DIR, SEQUENCES_DIR
from gpu_utils import check_system_gpu, check_docker_gpu_access, verify_alphafold_gpu_usage, monitor_gpu_during_run

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_alphafold(job_id, sequence, name, job_status, sasUrl=None, storageAccount=None, blobName=None, containerName=None):
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

        if storageAccount and containerName and blobName:
            job_status[job_id]["storage_account"] = storageAccount
            job_status[job_id]["container_name"] = containerName
            job_status[job_id]["blob_name"] = blobName
        elif sasUrl:
            job_status[job_id]["sas_url"] = sasUrl

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

                    # Upload to Azure Blob storage
                    azure_uploaded = False
                    storage_account = job_status[job_id].get("storage_account")
                    container_name = job_status[job_id].get("container_name")
                    blob_name = job_status[job_id].get("blob_name")

                    if storage_account and container_name and blob_name:
                        try:
                            # Upload file to Azure Blob Storage using DefaultAzureCredential (Managed Identity)
                            logger.info(f"Uploading results to Azure Blob Storage {storage_account}/{container_name}/{blob_name}")
                            
                            # Try using managed identity first
                            try:
                                credential = DefaultAzureCredential()
                                blob_client = BlobClient(
                                    account_url=f"https://{storage_account}.blob.core.windows.net",
                                    container_name=container_name,
                                    blob_name=blob_name,
                                    credential=credential
                                )
                                
                                # Upload the file
                                with open(file_path, "rb") as data:
                                    blob_client.upload_blob(data, overwrite=True)
                                
                                azure_uploaded = True
                                logger.info(f"Successfully uploaded {result_file} to Azure Blob Storage for job {job_id}")
                            except Exception as e:
                                logger.error(f"Error uploading with Managed Identity: {str(e)}")
                                
                                # Fallback to SAS URL if available
                                sas_url = job_status[job_id].get("sas_url")
                                if sas_url:
                                    try:
                                        import requests
                                        logger.info("Falling back to SAS URL upload method")
                                        with open(file_path, "rb") as f:
                                            response = requests.put(sas_url, data=f)

                                        if response.status_code in [200, 201]:
                                            azure_uploaded = True
                                            logger.info(f"Successfully uploaded {result_file} to Azure Blob Storage using SAS URL for job {job_id}")
                                        else:
                                            logger.error(f"Failed to upload to Azure with SAS URL: {response.status_code} {response.text}")
                                    except Exception as e2:
                                        logger.error(f"Error uploading to Azure with SAS URL: {str(e2)}")
                        except Exception as e:
                            logger.error(f"Error uploading to Azure Blob Storage: {str(e)}")
                            
                            # Fallback to SAS URL if available
                            sas_url = job_status[job_id].get("sas_url")
                            if sas_url:
                                try:
                                    import requests
                                    logger.info("Falling back to SAS URL upload method")
                                    with open(file_path, "rb") as f:
                                        response = requests.put(sas_url, data=f)

                                    if response.status_code in [200, 201]:
                                        azure_uploaded = True
                                        logger.info(f"Successfully uploaded {result_file} to Azure Blob Storage using SAS URL for job {job_id}")
                                    else:
                                        logger.error(f"Failed to upload to Azure with SAS URL: {response.status_code} {response.text}")
                                except Exception as e2:
                                    logger.error(f"Error uploading to Azure with SAS URL: {str(e2)}")

                    # Copy the file to a known location for easier access
                    output_file = os.path.join(job_dir, "ranked_0.pdb")
                    shutil.copy(file_path, output_file)

                    job_status[job_id] = {
                        "status": "completed",
                        "progress": 100,
                        "result_file": output_file,
                        "azure_uploaded": azure_uploaded,
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
