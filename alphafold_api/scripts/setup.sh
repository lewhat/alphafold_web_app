#!/bin/bash
# Update the system
sudo apt-get update
sudo apt-get upgrade -y

# Install git and other dependencies
sudo apt-get install -y build-essential git nvidia-cuda-toolkit lsb-release wget software-properties-common apt-transport-https ca-certificates gnupg curl

# Install Docker
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
sudo apt-get update
sudo apt-get install -y docker-ce

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add current user to docker group to run docker without sudo
sudo usermod -aG docker $USER
newgrp docker

# Install NVIDIA drivers (if using GPU instance)
sudo apt-get install -y nvidia-driver-535

# Install NVIDIA Container Toolkit (for GPU acceleration)
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker

# Install aria2
sudo apt-get install -y aria2

# Create directories for AlphaFold
mkdir -p ~/alphafold_data
mkdir -p ~/alphafold_output

# Clone the AlphaFold repository
git clone https://github.com/deepmind/alphafold.git
cd alphafold


# Build the AlphaFold Docker image
sudo docker build -f docker/Dockerfile -t alphafold .

# Install Python and dependencies for the Flask API
sudo apt-get install -y python3 python3-pip
pip3 install flask flask-cors gunicorn requests

# Install Python requirements for running the Docker container
pip3 install -r docker/requirements.txt

# Test NVIDIA GPU availability with Docker
docker run --rm --gpus all nvidia/cuda:12.2.2-base-ubuntu20.04 nvidia-smi


echo "Setup complete!"
echo "Now run the download_all_data.sh script to download the AlphaFold databases:"
echo "./alphafold/scripts/download_all_data.sh ~/alphafold_data"
echo "Note: This will download about 556GB of data and may take a long time."

