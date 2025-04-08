terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 4.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Variables
variable "aws_region" {
  description = "AWS region for resources"
  default     = "us-east-1"
}

variable "app_name" {
  description = "Base name for resources"
  default     = "alphafold-app"
}

variable "ec2_key_name" {
  description = "Name of EC2 key pair for SSH access"
  default     = "alphafold-key" # Make sure this key exists in your AWS account
}

variable "ec2_instance_type" {
  description = "EC2 instance type for AlphaFold VM"
  default     = "g4dn.4xlarge" # GPU-enabled instance for AlphaFold
}

# VPC and Network Configuration
resource "aws_vpc" "vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.app_name}-vpc"
  }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.vpc.id

  tags = {
    Name = "${var.app_name}-igw"
  }
}

# Subnets
resource "aws_subnet" "public_subnet_1" {
  vpc_id                  = aws_vpc.vpc.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.app_name}-public-subnet-1"
  }
}

resource "aws_subnet" "public_subnet_2" {
  vpc_id                  = aws_vpc.vpc.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.app_name}-public-subnet-2"
  }
}

# Route Tables
resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name = "${var.app_name}-public-rt"
  }
}

resource "aws_route_table_association" "public_subnet_1_rta" {
  subnet_id      = aws_subnet.public_subnet_1.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table_association" "public_subnet_2_rta" {
  subnet_id      = aws_subnet.public_subnet_2.id
  route_table_id = aws_route_table.public_rt.id
}

#############################
# S3 BUCKET RESOURCES
#############################

# S3 bucket for protein structure files
resource "aws_s3_bucket" "structure_bucket" {
  bucket = "${var.app_name}-structures"

  tags = {
    Name = "Protein Structure Files"
  }
}

# S3 bucket settings
resource "aws_s3_bucket_versioning" "structure_bucket_versioning" {
  bucket = aws_s3_bucket.structure_bucket.id
  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_cors_configuration" "structure_bucket_cors" {
  bucket = aws_s3_bucket.structure_bucket.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT"]
    allowed_origins = ["*"]  # TODO: In production, restrict to your application's domain
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "structure_bucket_encryption" {
  bucket = aws_s3_bucket.structure_bucket.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "structure_bucket_access" {
  bucket = aws_s3_bucket.structure_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# S3 bucket for Elastic Beanstalk application versions
resource "aws_s3_bucket" "eb_bucket" {
  bucket = "${var.app_name}-eb-deployments"

  tags = {
    Name = "Elastic Beanstalk Application Versions"
  }
}

#############################
# IAM ROLES AND POLICIES
#############################

# IAM role for EC2 instance profile
resource "aws_iam_role" "ec2_role" {
  name = "${var.app_name}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

# Policy for S3 access
resource "aws_iam_policy" "s3_access_policy" {
  name        = "${var.app_name}-s3-access-policy"
  description = "Policy for S3 access for AlphaFold app"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          "${aws_s3_bucket.structure_bucket.arn}",
          "${aws_s3_bucket.structure_bucket.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ec2_s3_policy_attachment" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = aws_iam_policy.s3_access_policy.arn
}

resource "aws_iam_role_policy_attachment" "ec2_ssm_policy_attachment" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2_instance_profile" {
  name = "${var.app_name}-ec2-instance-profile"
  role = aws_iam_role.ec2_role.name
}

# IAM role for Elastic Beanstalk
resource "aws_iam_role" "eb_service_role" {
  name = "${var.app_name}-eb-service-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "elasticbeanstalk.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eb_service_policy" {
  role       = aws_iam_role.eb_service_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkService"
}

resource "aws_iam_role_policy_attachment" "eb_enhanced_health_policy" {
  role       = aws_iam_role.eb_service_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth"
}

# IAM role for Elastic Beanstalk EC2 instances
resource "aws_iam_role" "eb_ec2_role" {
  name = "${var.app_name}-eb-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "eb_web_tier_policy" {
  role       = aws_iam_role.eb_ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier"
}

resource "aws_iam_role_policy_attachment" "eb_s3_policy_attachment" {
  role       = aws_iam_role.eb_ec2_role.name
  policy_arn = aws_iam_policy.s3_access_policy.arn
}

resource "aws_iam_instance_profile" "eb_instance_profile" {
  name = "${var.app_name}-eb-instance-profile"
  role = aws_iam_role.eb_ec2_role.name
}

#############################
# SECURITY GROUPS
#############################

# Security group for Elastic Beanstalk
resource "aws_security_group" "eb_sg" {
  name        = "${var.app_name}-eb-sg"
  description = "Security group for Elastic Beanstalk environment"
  vpc_id      = aws_vpc.vpc.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.app_name}-eb-sg"
  }
}

# Security group for AlphaFold EC2 instance
resource "aws_security_group" "alphafold_sg" {
  name        = "${var.app_name}-alphafold-sg"
  description = "Security group for AlphaFold EC2 instance"
  vpc_id      = aws_vpc.vpc.id

  ingress {
    from_port   = 5000
    to_port     = 5000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow API requests from any source"
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "SSH access"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.app_name}-alphafold-sg"
  }
}

#############################
# ELASTIC BEANSTALK RESOURCES
#############################

# Elastic Beanstalk application
resource "aws_elastic_beanstalk_application" "eb_app" {
  name        = "${var.app_name}-app"
  description = "AlphaFold React/Express TypeScript Application"
}

# Elastic Beanstalk environment
resource "aws_elastic_beanstalk_environment" "eb_env" {
  name                = "${var.app_name}-env"
  application         = aws_elastic_beanstalk_application.eb_app.name
  platform_arn        = "arn:aws:elasticbeanstalk:us-east-1::platform/Node.js 20 running on 64bit Amazon Linux 2023/6.5.0"
  solution_stack_name = null
  tier                = "WebServer"

  setting {
    namespace = "aws:ec2:vpc"
    name      = "VPCId"
    value     = aws_vpc.vpc.id
  }

  setting {
    namespace = "aws:ec2:vpc"
    name      = "Subnets"
    value     = "${aws_subnet.public_subnet_1.id},${aws_subnet.public_subnet_2.id}"
  }

  setting {
    namespace = "aws:ec2:vpc"
    name      = "ELBSubnets"
    value     = "${aws_subnet.public_subnet_1.id},${aws_subnet.public_subnet_2.id}"
  }

  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "IamInstanceProfile"
    value     = aws_iam_instance_profile.eb_instance_profile.name
  }

  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "SecurityGroups"
    value     = aws_security_group.eb_sg.id
  }

  setting {
    namespace = "aws:elasticbeanstalk:environment"
    name      = "ServiceRole"
    value     = aws_iam_role.eb_service_role.name
  }

  setting {
    namespace = "aws:elasticbeanstalk:environment"
    name      = "LoadBalancerType"
    value     = "application"
  }

  setting {
    namespace = "aws:autoscaling:asg"
    name      = "MinSize"
    value     = "1"
  }

  setting {
    namespace = "aws:autoscaling:asg"
    name      = "MaxSize"
    value     = "2"
  }

  setting {
    namespace = "aws:autoscaling:launchconfiguration"
    name      = "InstanceType"
    value     = "t3.small"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "NODE_ENV"
    value     = "production"
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "S3_BUCKET_NAME"
    value     = aws_s3_bucket.structure_bucket.bucket
  }

  setting {
    namespace = "aws:elasticbeanstalk:application:environment"
    name      = "ALPHAFOLD_VM_ENDPOINT"
    value     = "http://${aws_instance.alphafold_vm.public_ip}:5000/predict"
  }
}

#############################
# EC2 ALPHAFOLD VM
#############################

# Public IP for AlphaFold VM
resource "aws_eip" "alphafold_eip" {
  vpc = true

  tags = {
    Name = "${var.app_name}-alphafold-eip"
  }
}

# EC2 instance for AlphaFold with public IP
resource "aws_instance" "alphafold_vm" {
  ami                    = "ami-0261755bbcb8c4a84" # Amazon Linux 2 AMI (update with appropriate AMI for your region)
  instance_type          = var.ec2_instance_type
  key_name               = var.ec2_key_name
  vpc_security_group_ids = [aws_security_group.alphafold_sg.id]
  subnet_id              = aws_subnet.public_subnet_1.id
  iam_instance_profile   = aws_iam_instance_profile.ec2_instance_profile.name

  root_block_device {
    volume_size = 3100
    volume_type = "gp3"
  }

  tags = {
    Name = "${var.app_name}-alphafold-vm"
  }
}

# Associate EIP with AlphaFold VM
resource "aws_eip_association" "alphafold_eip_assoc" {
  instance_id   = aws_instance.alphafold_vm.id
  allocation_id = aws_eip.alphafold_eip.id
}

#############################
# OUTPUTS
#############################

output "elastic_beanstalk_url" {
  value       = aws_elastic_beanstalk_environment.eb_env.endpoint_url
  description = "The URL of the Elastic Beanstalk environment"
}

output "s3_bucket_name" {
  value       = aws_s3_bucket.structure_bucket.bucket
  description = "The name of the S3 bucket for protein structures"
}

output "alphafold_vm_public_ip" {
  value       = aws_eip.alphafold_eip.public_ip
  description = "The public IP of the AlphaFold VM"
}
