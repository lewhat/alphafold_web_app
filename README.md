# AlphaFold Protein Structure Prediction Web Application Prototype

A full-stack web application for protein structure prediction using AlphaFold, with cloud deployment options for both AWS and Azure.

## Overview

This application allows users to submit protein sequences and receive 3D structure predictions using AlphaFold. The system consists of:

- **Frontend**: React/TypeScript application with 3D protein visualization
- **Backend**: Express.js API for job management and cloud storage integration
- **Processing**: AlphaFold running on a GPU-enabled VM

### Components

1. **Frontend (React/TypeScript)**
   - Protein sequence input with validation
   - Job status tracking and history
   - 3D visualization of protein structures using 3Dmol.js

2. **Backend (Express/TypeScript)**
   - RESTful API for sequence submission and job status
   - Job queuing and tracking
   - Cloud storage integration (S3/Blob Storage)
   - SAS/Pre-signed URL generation

3. **AlphaFold VM**
   - Flask API for receiving prediction requests
   - AlphaFold running in Docker
   - Direct cloud storage integration via SDKs

## Data Flow

1. User submits a protein sequence through the UI
2. Backend generates a job ID and adds it to the queue
3. Backend generates storage URLs and sends request to AlphaFold VM
4. AlphaFold VM processes the request and uploads results to cloud storage
5. Frontend polls for status and displays the 3D structure when ready

## Deployment Options

### AWS Deployment

- **Frontend**: Hosted on AWS Elastic Beanstalk
- **Backend**: Node.js on AWS Elastic Beanstalk
- **Storage**: Amazon S3
- **Processing**: EC2 instance with GPU

### Azure Deployment

- **Frontend**: Hosted on Azure App Service
- **Backend**: Node.js on Azure App Service
- **Storage**: Azure Blob Storage
- **Processing**: Azure VM with GPU

## Setup and Deployment

### Prerequisites

- Node.js 18+
- Python 3.8+
- Docker
- AWS CLI or Azure CLI
- Terraform

### Local Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/lewhat/alphafold_web_app.git
   cd alphafold_web_app
   ```

2. Install dependencies:
   ```bash
   # Install frontend dependencies
   cd aws or cd azure
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the `src/server` directory with:
   ```
   # For AWS
   S3_BUCKET_NAME=your-bucket-name
   NODE_ENV="production"
   ALPHAFOLD_VM_ENDPOINT=http://your-vm-ip:5000/predict

   # For Azure
   AZURE_STORAGE_ACCOUNT_NAME=yourstorageaccount
   AZURE_STORAGE_CONTAINER_NAME=structures
   AZURE_STORAGE_CONNECTION_STRING=your-connection-string
   ALPHAFOLD_VM_ENDPOINT=http://your-vm-ip:5000/predict
   ```

4. Run development servers:
   ```bash
   npm run dev
   ```

### Deployment

1. Set up infrastructure:
   ```bash
   cd terraform
   terraform init
   terraform apply
   ```

2. Deploy application:
   ```bash
   npm run build

   # setup your CI/CD
   ```

3. Configure the AlphaFold VM:
   - copy alphafold_vm directory to your remote server
   ```bash
     scp path/local/alphafold_web_app/alphafold_api <user>@<server>:/home/<user>/
   ```
   - SSH to your server
   - Install all required packages and set up AlphaFold
   ```bash
   chmod +x ~/alphafold_api/scripts/setup.sh
   ./scripts/setup.sh
   ```
   - Download Alphafold Databases ( 2.7TB make sure you have voulme to handle that)
   ```bash
   chmod +x ~/alphafold_api/scripts/download.sh
   ./scripts/download.sh
   ```
   - Configure the Flask application
   ```bash
    sudo nano /etc/systemd/system/alphafold-api.service

   # update the file according to your OS... in this example it's ubuntu
   
    [Unit]
    Description=AlphaFold API Service
    After=network.target
    
    [Service]
    User=ubuntu
    WorkingDirectory=/home/ubuntu/alphafold_api
    ExecStart=/home/ubuntu/.local/bin/gunicorn -w 2 -b 0.0.0.0:5000 --timeout 1800 app:app
    Restart=always
    StandardOutput=syslog
    StandardError=syslog
    SyslogIdentifier=alphafold-api
    Environment="PATH=/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin"
    
    [Install]
    WantedBy=multi-user.target

   ```
   - start flask 
  ```bash
  sudo systemctl daemon-reload
  sudo systemctl start alphafold-api
  ```
   - Set up and install boto3 or Azure Storage SDK for python ( make sure you the right credentials for authentication)

## Additional Information
### Azure code changes
- copy and paste files on /azure to their respective directory

### Security Considerations

- The AlphaFold VM has restricted access via security groups/NSGs
- Authentication is handled via IAM roles or Managed Identities
- All data is encrypted in transit and at rest
- SAS/pre-signed URLs have limited time validity

### Maintenance

- Logs are available in CloudWatch (AWS) or Application Insights (Azure)
- VM status can be monitored via health check endpoint
- Job queue and processing status are persisted for recovery

### Troubleshooting
- on some Docker versions, Docker won't use GPU even though the "--use_gpu=true" flag is set
```bash
# check the log for GPU utilaiztion
sudo journalctl -fu alphafold-api

# to double check if GPU utilaiztion run 
nvidia-smi

# if 0 memory is allocated, then update run_docker.py
# create backup 
cp /home/ubuntu/alphafold/docker/run_docker.py /home/ubuntu/alphafold/docker/run_docker.py.backup

vi /home/ubuntu/alphafold/docker/run_docker.py

# find
device_requests = [
    docker.types.DeviceRequest(driver='nvidia', capabilities=[['gpu']])
] if FLAGS.use_gpu else None

# replace with
device_requests = [
    docker.types.DeviceRequest(driver='nvidia', count=-1, capabilities=[['gpu']])  # count=-1 means "all GPUs"
] if FLAGS.use_gpu else None

# find
 environment={
    'NVIDIA_VISIBLE_DEVICES': FLAGS.gpu_devices,
    'TF_FORCE_UNIFIED_MEMORY': '1',
    'XLA_PYTHON_CLIENT_MEM_FRACTION': '4.0',
    }

# replace with
environment={
    'NVIDIA_VISIBLE_DEVICES': FLAGS.gpu_devices,
    'TF_FORCE_UNIFIED_MEMORY': '1',
    'XLA_PYTHON_CLIENT_MEM_FRACTION': '4.0',
    'TF_FORCE_GPU_ALLOW_GROWTH': 'true',
    'CUDA_VISIBLE_DEVICES': '0',  # Explicitly use the first GPU
    'TF_ENABLE_ONEDNN_OPTS': '0',  # Disable oneDNN which can cause issues
}
```
- check Docker runtime
```bash
docker info | grep -i runtime

# if Nvidia is not listed run to see if it's setup
cat /etc/docker/daemon.json

# if that file doesn't exist run
sudo mkdir -p /etc/docker
sudo nano /etc/docker/daemon.json

# add the following in the file
{
    "runtimes": {
        "nvidia": {
            "path": "nvidia-container-runtime",
            "runtimeArgs": []
        }
    }
}

# restart docker
sudo systemctl restart docker

# restart flask api
sudo systemctl restart alphafold-api
```

## Acknowledgements

- [AlphaFold](https://github.com/deepmind/alphafold) by DeepMind
- [3Dmol.js](https://3dmol.csb.pitt.edu/) for protein visualization

