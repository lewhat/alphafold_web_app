import logging
import os
import subprocess
import time

logger = logging.getLogger(__name__)


def check_system_gpu():
    """Check if GPU is available at the system level."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free,memory.used",
                "--format=csv,noheader",
            ],
            capture_output=True,
            text=True,
            check=True,
        )

        if result.stdout:
            logger.info(f"GPU detected: {result.stdout.strip()}")
            return True, result.stdout.strip()
        else:
            logger.warning("nvidia-smi returned empty output")
            return False, "No GPU information returned by nvidia-smi"
    except subprocess.CalledProcessError as e:
        logger.error(f"Error running nvidia-smi: {e}, output: {e.stderr}")
        return False, e.stderr
    except FileNotFoundError:
        logger.error(
            "nvidia-smi command not found. NVIDIA drivers may not be installed."
        )
        return False, "nvidia-smi command not found"


def check_docker_gpu_access():
    """Check if Docker has access to GPU."""
    try:
        result = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--gpus=all",
                "nvidia/cuda:12.2.2-base-ubuntu20.04",
                "nvidia-smi",
            ],
            capture_output=True,
            text=True,
            check=True,
        )

        if result.stdout:
            logger.info(f"Docker GPU access confirmed")
            return True, result.stdout.strip()
        else:
            logger.warning("Docker GPU test returned empty output")
            return False, "No GPU information returned by Docker test"
    except subprocess.CalledProcessError as e:
        logger.error(f"Error testing Docker GPU access: {e}, output: {e.stderr}")
        return False, e.stderr
    except FileNotFoundError:
        logger.error("Docker command not found")
        return False, "Docker command not found"


def verify_alphafold_gpu_usage(job_id, output_dir):
    """
    Verify GPU usage by checking AlphaFold logs for GPU-related messages.
    Returns True if there's evidence of GPU usage, False otherwise.
    """
    try:
        # Find log files in the output directory
        log_file = None
        job_dir = os.path.join(output_dir, job_id)

        # Look for results directories
        results_dirs = [
            d for d in os.listdir(job_dir) if os.path.isdir(os.path.join(job_dir, d))
        ]

        if not results_dirs:
            logger.warning(f"No results directory found for job {job_id}")
            return False, "No results directory found"

        result_dir = os.path.join(job_dir, sorted(results_dirs)[-1])

        # Look for log.txt files
        log_files = [f for f in os.listdir(result_dir) if f == "log.txt"]

        if not log_files:
            logger.warning(f"No log.txt found in results directory for job {job_id}")
            return False, "No log.txt found"

        log_file = os.path.join(result_dir, log_files[0])

        # Check log file for GPU evidence
        gpu_keywords = [
            "Using GPU",
            "CUDA_VISIBLE_DEVICES",
            "TensorFlow device",
            "device:GPU",
            "Found device",
            "XLA_PYTHON_CLIENT_MEM_FRACTION",
            "cuda",
            "jaxlib.xla_extension.GpuDevice",
        ]

        gpu_evidence = []
        gpu_found = False

        with open(log_file, "r") as f:
            for line in f:
                for keyword in gpu_keywords:
                    if keyword in line:
                        gpu_evidence.append(line.strip())
                        gpu_found = True

        if gpu_found:
            logger.info(f"GPU usage confirmed in AlphaFold logs for job {job_id}")
            return True, "\n".join(
                gpu_evidence[:10]
            )  # Return first 10 pieces of evidence
        else:
            logger.warning(
                f"No evidence of GPU usage found in AlphaFold logs for job {job_id}"
            )
            return False, "No GPU usage evidence found in logs"

    except Exception as e:
        logger.error(f"Error verifying AlphaFold GPU usage: {str(e)}")
        return False, str(e)


def monitor_gpu_during_run(job_id, job_status):
    """
    Periodically monitor GPU usage during an AlphaFold run
    and update the job status with GPU information.
    Should be run in a separate thread.
    """
    try:
        while job_status.get(job_id, {}).get("status") == "running":
            # Get GPU usage information using nvidia-smi
            result = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=utilization.gpu,memory.used,memory.total",
                    "--format=csv,noheader",
                ],
                capture_output=True,
                text=True,
            )

            if result.returncode == 0 and result.stdout:
                gpu_info = result.stdout.strip().split(",")
                if len(gpu_info) >= 3:
                    utilization = gpu_info[0].strip()
                    memory_used = gpu_info[1].strip()
                    memory_total = gpu_info[2].strip()

                    # Update job status with GPU information
                    job_status[job_id]["gpu_info"] = {
                        "utilization": utilization,
                        "memory_used": memory_used,
                        "memory_total": memory_total,
                        "time": int(time.time()),
                    }

                    logger.info(
                        f"GPU utilization: {utilization}, Memory: {memory_used}/{memory_total}"
                    )

            # Sleep for 10 seconds before checking again
            time.sleep(10)
    except Exception as e:
        logger.error(f"Error monitoring GPU: {str(e)}")
