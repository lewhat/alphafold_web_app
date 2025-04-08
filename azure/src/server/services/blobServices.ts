import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  BlobSASPermissions,
  generateBlobSASQueryParameters
} from '@azure/storage-blob';
import dotenv from 'dotenv';

dotenv.config();

const storageAccountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const storageAccountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

let blobServiceClient: BlobServiceClient;
if (connectionString) {
  blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
} else if (storageAccountName && storageAccountKey) {
  const sharedKeyCredential = new StorageSharedKeyCredential(
    storageAccountName,
    storageAccountKey
  );
  blobServiceClient = new BlobServiceClient(
    `https://${storageAccountName}.blob.core.windows.net`,
    sharedKeyCredential
  );
} else {
  throw new Error('Azure Storage credentials are not properly configured');
}

const containerClient = blobServiceClient.getContainerClient(containerName);

export async function generateSasUrl(blobName: string): Promise<string> {
  if (!storageAccountName || !storageAccountKey) {
    throw new Error('Storage account name and key are required for SAS generation');
  }

  const blobClient = containerClient.getBlobClient(blobName);

  const sharedKeyCredential = new StorageSharedKeyCredential(
    storageAccountName,
    storageAccountKey
  );

  const expiresOn = new Date();
  expiresOn.setHours(expiresOn.getHours() + 24);

  const sasOptions = {
    containerName,
    blobName,
    permissions: BlobSASPermissions.parse('r'), // Read permission
    expiresOn,
  };

  const sasToken = generateBlobSASQueryParameters(
    sasOptions,
    sharedKeyCredential
  ).toString();

  return `${blobClient.url}?${sasToken}`;
}

export async function checkBlobExists(blobName: string): Promise<boolean> {
  const blobClient = containerClient.getBlobClient(blobName);
  try {
    await blobClient.getProperties();
    return true;
  } catch (error) {
    if (error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

export function getContainerName(): string {
  if (!containerName) {
    throw new Error('AZURE_STORAGE_CONTAINER_NAME environment variable is not set');
  }
  return containerName;
}

export function getStorageAccountName(): string {
  if (!storageAccountName) {
    throw new Error('AZURE_STORAGE_ACCOUNT_NAME environment variable is not set');
  }
  return storageAccountName;
}
