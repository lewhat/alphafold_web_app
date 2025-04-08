terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

# Variables
variable "location" {
  description = "Azure region for resources"
  default     = "eastus"
}

variable "app_name" {
  description = "Base name for resources"
  default     = "alphafold-app"
}

variable "vm_admin_username" {
  description = "Admin username for Azure VM"
  default     = "alphafoldadmin"
}

variable "vm_admin_password" {
  description = "Admin password for Azure VM"
  sensitive   = true
}

variable "vm_size" {
  description = "Azure VM size for AlphaFold VM"
  default     = "Standard_NC6s_v3" # GPU-enabled VM for AlphaFold
}

# Resource Group
resource "azurerm_resource_group" "rg" {
  name     = "${var.app_name}-rg"
  location = var.location
}

# Virtual Network
resource "azurerm_virtual_network" "vnet" {
  name                = "${var.app_name}-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}

# Subnet
resource "azurerm_subnet" "subnet" {
  name                 = "${var.app_name}-subnet"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.0.1.0/24"]
}

# Public IP for AlphaFold VM
resource "azurerm_public_ip" "alphafold_pip" {
  name                = "${var.app_name}-alphafold-pip"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

# Network Security Group for AlphaFold VM
resource "azurerm_network_security_group" "alphafold_nsg" {
  name                = "${var.app_name}-alphafold-nsg"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  security_rule {
    name                       = "SSH"
    priority                   = 1001
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "Flask"
    priority                   = 1002
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5000"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

# Network Interface for AlphaFold VM
resource "azurerm_network_interface" "alphafold_nic" {
  name                = "${var.app_name}-alphafold-nic"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.subnet.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.alphafold_pip.id
  }
}

# Connect NSG to NIC
resource "azurerm_network_interface_security_group_association" "alphafold_nsg_assoc" {
  network_interface_id      = azurerm_network_interface.alphafold_nic.id
  network_security_group_id = azurerm_network_security_group.alphafold_nsg.id
}

# Storage Account for protein structures
resource "azurerm_storage_account" "storage" {
  name                     = replace("${var.app_name}storage", "-", "")
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"

  blob_properties {
    cors_rule {
      allowed_headers    = ["*"]
      allowed_methods    = ["GET", "PUT"]
      allowed_origins    = ["*"]
      exposed_headers    = ["*"]
      max_age_in_seconds = 3600
    }
  }
}

# Blob Container for protein structures
resource "azurerm_storage_container" "proteins" {
  name                  = "proteins"
  storage_account_name  = azurerm_storage_account.storage.name
  container_access_type = "private"
}

# AlphaFold VM
resource "azurerm_linux_virtual_machine" "alphafold_vm" {
  name                = "${var.app_name}-alphafold-vm"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  size                = var.vm_size
  admin_username      = var.vm_admin_username
  admin_password      = var.vm_admin_password
  disable_password_authentication = false
  
  network_interface_ids = [
    azurerm_network_interface.alphafold_nic.id,
  ]

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 512
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-focal"
    sku       = "20_04-lts"
    version   = "latest"
  }

  # Attach additional data disk for AlphaFold data
  identity {
    type = "SystemAssigned"
  }
}

# Data disk for AlphaFold
resource "azurerm_managed_disk" "alphafold_data_disk" {
  name                 = "${var.app_name}-data-disk"
  location             = azurerm_resource_group.rg.location
  resource_group_name  = azurerm_resource_group.rg.name
  storage_account_type = "Premium_LRS"
  create_option        = "Empty"
  disk_size_gb         = 3000
}

resource "azurerm_virtual_machine_data_disk_attachment" "alphafold_disk_attach" {
  managed_disk_id    = azurerm_managed_disk.alphafold_data_disk.id
  virtual_machine_id = azurerm_linux_virtual_machine.alphafold_vm.id
  lun                = "10"
  caching            = "ReadWrite"
}

# Role assignment to allow VM to access Storage
resource "azurerm_role_assignment" "vm_storage_role" {
  scope                = azurerm_storage_account.storage.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_virtual_machine.alphafold_vm.identity[0].principal_id
}

# App Service Plan for the web app
resource "azurerm_service_plan" "app_service_plan" {
  name                = "${var.app_name}-app-service-plan"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  os_type             = "Linux"
  sku_name            = "P1v2"
}

# App Service for the web app
resource "azurerm_linux_web_app" "app_service" {
  name                = "${var.app_name}-app"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  service_plan_id     = azurerm_service_plan.app_service_plan.id
  
  site_config {
    application_stack {
      node_version = "20-lts"
    }
    always_on = true
  }

  app_settings = {
    "WEBSITES_ENABLE_APP_SERVICE_STORAGE" = "true"
    "STORAGE_ACCOUNT_NAME"                = azurerm_storage_account.storage.name
    "STORAGE_CONTAINER_NAME"              = azurerm_storage_container.proteins.name
    "ALPHAFOLD_VM_ENDPOINT"               = "http://${azurerm_public_ip.alphafold_pip.ip_address}:5000/predict"
    "WEBSITE_NODE_DEFAULT_VERSION"        = "~20"
    "NODE_ENV"                            = "production"
  }

  identity {
    type = "SystemAssigned"
  }
}

# Role assignment to allow App Service to access Storage
resource "azurerm_role_assignment" "app_storage_role" {
  scope                = azurerm_storage_account.storage.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_web_app.app_service.identity[0].principal_id
}

# Outputs
output "app_service_url" {
  value       = "https://${azurerm_linux_web_app.app_service.default_hostname}"
  description = "The URL of the App Service"
}

output "storage_account_name" {
  value       = azurerm_storage_account.storage.name
  description = "The name of the Storage Account for protein structures"
}

output "alphafold_vm_public_ip" {
  value       = azurerm_public_ip.alphafold_pip.ip_address
  description = "The public IP of the AlphaFold VM"
}

